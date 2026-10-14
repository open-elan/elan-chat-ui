"use client";

/**
 * One conversation.
 *
 * ── THE TRANSCRIPT IS BUILT FROM EVENTS, AND NOT FROM A LOCAL LIST ───────────
 *
 * `started` carries the text that began the run, so the human's turn is in the
 * stream alongside the agent's. That is what lets history and live rendering
 * share ONE code path: `/api/history` folds recorded runs into the same
 * `AgentEvent` shape the socket delivers, and everything below treats the two
 * identically. A local list of turns would have needed a second renderer, and
 * the two would have disagreed.
 *
 * The one thing kept locally is an OPTIMISTIC echo of the message just sent:
 * `queued` arrives immediately but carries no text, and `started` carries the
 * text but cannot arrive until a pod exists — which on a cold start is a KEDA
 * poll, a node, a sandbox and an ADK import later. Showing nothing for that
 * long would read as the message having been lost.
 *
 * ── EVERY RULE ABOUT THE STREAM COMES FROM THE SDK ───────────────────────────
 *
 * `textOf` and `authorOf` are imported rather than reimplemented, which is the
 * reason this example exists at all. The app it replaces hand-mirrored the
 * event model: it lost `segment`, `project_id` and `target_kind`, invented an
 * `author` the envelope has never had, and all four mistakes typechecked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentEvents } from "elan-sdk/react";
import { authorOf, textOf, type AgentEvent } from "elan-sdk";

import { Approvals } from "./Approvals";
import { Markdown } from "./Markdown";
import { Tools } from "./Tools";
import { toolsIn } from "@/lib/tools";
import { conversations } from "@/lib/sessions";

/** Kinds that mean the agent is no longer mid-thought. */
const SETTLES = new Set(["content", "finished", "error", "paused"]);

interface Turn {
  invocationId: string;
  said: string;
  replied: string;
  author: string;
  failure: string;
  /** The liveness label still standing, or "". */
  status: string;
  ended: boolean;
}

/**
 * Fold a run's events into a turn.
 *
 * IN ARRIVAL ORDER, which is why the status is computed by walking rather than
 * by looking at the last `typing`: a turn goes thinking → content → calling a
 * tool → content, so the indicator has to clear when the agent speaks and come
 * back when it goes quiet again. The typing plugin's own comment says the same
 * thing from the other side — it deliberately does not emit `idle` after the
 * model returns, because `content`, `finished` and `error` already mean clear.
 */
function fold(events: readonly AgentEvent[]): Turn[] {
  const order: string[] = [];
  const byRun = new Map<string, Turn>();

  for (const event of events) {
    const id = event.invocation_id;
    if (!byRun.has(id)) {
      order.push(id);
      byRun.set(id, {
        invocationId: id, said: "", replied: "", author: "",
        failure: "", status: "", ended: false,
      });
    }
    const turn = byRun.get(id)!;

    if (SETTLES.has(event.kind)) turn.status = "";

    switch (event.kind) {
      case "started":
        // The human's own words, published by the engine on the event that
        // says the run began.
        turn.said = textOf(event) || turn.said;
        break;
      case "content":
        turn.replied += textOf(event);
        turn.author = turn.author || authorOf(event);
        break;
      case "typing": {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        // THE LABEL IS READY-MADE, on purpose: the plugin carries both a
        // structured `state` and a sentence, so a client does not have to
        // invent phrasing and a translation has somewhere to live.
        turn.status = String(payload["label"] ?? "");
        break;
      }
      case "error":
        turn.failure = textOf(event) || "the run failed";
        turn.ended = true;
        break;
      case "finished":
        turn.ended = true;
        break;
      default:
        break;
    }
  }

  return order.map((id) => byRun.get(id)!);
}

export function Chat({ agent, sessionId }: { agent: string; sessionId: string }) {
  const { events, state, error } = useAgentEvents(sessionId);
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const [unavailable, setUnavailable] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ id: string; said: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  // ── the durable read, once per conversation ────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    setHistory([]);
    setPending([]);
    setRefused("");
    setUnavailable("");
    setLoading(true);
    void (async () => {
      try {
        const answer = await fetch(
          `/api/history?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!current) return;
        if (answer.ok) {
          const body = (await answer.json()) as {
            events?: AgentEvent[];
            unavailable?: string;
          };
          setHistory(body.events ?? []);
          // SAID ONCE, AND NOT AS A FAILURE. A platform whose image predates
          // `GET /v1/runs` cannot read history back, which is worth explaining
          // rather than showing an empty transcript and letting somebody
          // conclude their conversation was lost.
          setUnavailable(body.unavailable ?? "");
        }
        // A 404 is this app's own ownership refusal, or a conversation with
        // nothing recorded. Neither is worth a message.
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [sessionId]);

  // ONE ARRAY, MEMOISED. Three separate `[...history, ...events]` literals
  // would each be a new reference on every render, which would make the tool
  // fold and the pause lookup recompute for nothing.
  const allEvents = useMemo(() => [...history, ...events], [history, events]);

  const turns = useMemo(() => {
    // HISTORY FIRST, then live. A run present in both folds into one turn,
    // because the fold keys on the invocation id rather than appending.
    const folded = fold(allEvents);
    const known = new Set(folded.map((turn) => turn.invocationId));
    const echoes = pending
      .filter((item) => !known.has(item.id))
      .map<Turn>((item) => ({
        invocationId: item.id, said: item.said, replied: "", author: "",
        failure: "", status: "", ended: false,
      }));
    return [...folded, ...echoes];
  }, [allEvents, pending]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, events.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setRefused("");
    try {
      const answer = await fetch("/api/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, sessionId }),
      });
      const body = (await answer.json()) as { invocation_id?: string; error?: string };
      if (!answer.ok) {
        setRefused(body.error || `the invocation was refused (${answer.status})`);
        return;
      }
      setPending((held) => [...held, { id: body.invocation_id ?? "", said: text }]);
      conversations.title(sessionId, text);
      setDraft("");
    } catch (thrown) {
      setRefused(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setSending(false);
    }
  }, [draft, sending, sessionId]);

  // THE COMPOSER WAITS FOR THE SOCKET, and this is the ordering the whole
  // protocol turns on. Pub/Sub discards a message published to a topic with no
  // subscription, and rt-service creates the tenant's when its first socket
  // opens — so publishing before the stream is ready loses the entire reply on
  // a warm agent. Disabling the button makes that impossible by accident.
  const ready = state === "ready" && Boolean(sessionId);

  return (
    <div className="chat">
      <header className="chat-head">
        <span className="agent">{agent}</span>
        <span className={`state state-${state}`}>{state}</span>
      </header>

      <div className="transcript">
        {loading && <p className="empty">reading the conversation…</p>}
        {!loading && turns.length === 0 && (
          <p className="empty">Say something to {agent}.</p>
        )}

        {turns.map((turn) => (
          <article key={turn.invocationId || turn.said} className="turn">
            {turn.said && <p className="mine">{turn.said}</p>}

            {turn.replied && (
              <div className="theirs">
                <span className="author">{turn.author || agent}</span>
                {/* MARKDOWN, because a model writes it whether or not you
                    render it — and raw HTML inside it is NOT rendered. */}
                <Markdown>{turn.replied}</Markdown>
              </div>
            )}

            {/* WHAT IT DID, collapsed. Rendered after the reply because the
                answer is the point and the tools are the evidence — and only
                once the turn has settled, so the list does not grow under the
                reader's eyes while the agent is still working. */}
            {turn.ended && <Tools used={toolsIn(allEvents, turn.invocationId)} />}

            {/* LIVENESS, from the `typing` events. The label is the plugin's
                own sentence; the dots are ours. */}
            {turn.status && !turn.ended && (
              <p className="typing" aria-live="polite">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {turn.status}
              </p>
            )}

            {/* The one event rt-service sends itself, because a scaled-to-zero
                agent has no pod to send one. Only while nothing else has
                happened — otherwise it lingers under a finished turn. */}
            {!turn.status && !turn.replied && !turn.failure && !turn.ended && (
              <p className="waiting">
                queued — a sleeping agent is scheduled and started before it
                reads its queue, so the first reply after a quiet period is the
                slow one.
              </p>
            )}

            {turn.failure && <p className="failed">{turn.failure}</p>}

            <Approvals
              sessionId={sessionId}
              invocationId={turn.invocationId}
              events={allEvents}
              settled={turn.ended}
            />
          </article>
        ))}
        <div ref={bottom} />
      </div>

      {unavailable && <p className="notice">{unavailable}</p>}
      {error && <p className="failed">socket: {error}</p>}
      {refused && <p className="failed">{refused}</p>}

      <form
        className="composer"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(changed) => setDraft(changed.target.value)}
          placeholder={ready ? `Message ${agent}…` : "connecting…"}
          disabled={!ready || sending}
          aria-label="Message"
        />
        <button type="submit" disabled={!ready || sending || !draft.trim()}>
          {sending ? "sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
