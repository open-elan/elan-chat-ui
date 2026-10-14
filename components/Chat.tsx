"use client";

/**
 * The conversation.
 *
 * ── EVERY RULE ABOUT THE STREAM COMES FROM THE SDK ───────────────────────────
 *
 * `textOf` and `authorOf` are imported rather than reimplemented, and that is
 * the entire reason this example was rebuilt instead of moved. The app this
 * replaces hand-mirrored the event model and lost three fields and invented a
 * fourth — four mistakes, every one of which typechecked, one of them rendering
 * a chip that has never once appeared. Importing makes a drift a typecheck
 * error instead of a type that compiles and is wrong.
 *
 * `textOf` in particular: a reply is at `payload.content.parts[*].text` and the
 * parts must be JOINED. `payload.text` does not exist on a content event, and
 * reading it found nothing on every one of them — reporting an agent that had
 * answered perfectly well as one that said nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentEvents } from "elan-sdk/react";
import { authorOf, textOf, type AgentEvent } from "elan-sdk";

import { Approvals } from "./Approvals";

const SESSION_KEY = "elan-chat-session";

/**
 * One conversation, kept across reloads.
 *
 * THE SESSION ID IS YOURS TO CHOOSE — the platform does not mint one. A session
 * is keyed on `(app_name, user_id, session_id)`, so this id under a different
 * agent is a different conversation and another user's is not yours.
 */
function useSessionId(): string {
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    let held = "";
    try {
      held = window.localStorage.getItem(SESSION_KEY) ?? "";
    } catch {
      // Private windows and blocked site data both throw on access.
    }
    if (!held) {
      held = `chat-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      try {
        window.localStorage.setItem(SESSION_KEY, held);
      } catch {
        // A per-tab conversation is a fine degradation.
      }
    }
    setSessionId(held);
  }, []);
  return sessionId;
}

interface Turn {
  invocationId: string;
  said: string;
}

/** The agent's side of one run, folded the way the SDK folds it. */
function spokenIn(events: readonly AgentEvent[], invocationId: string): string {
  return events
    .filter((event) => event.invocation_id === invocationId && event.kind === "content")
    .map((event) => textOf(event))
    .join("");
}

function whoSpoke(events: readonly AgentEvent[], invocationId: string): string {
  for (const event of events) {
    if (event.invocation_id !== invocationId) continue;
    const author = authorOf(event);
    if (author) return author;
  }
  return "agent";
}

export function Chat({ agent }: { agent: string }) {
  const sessionId = useSessionId();
  const { events, state, error } = useAgentEvents(sessionId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, turns.length]);

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
      setTurns((held) => [
        ...held,
        { invocationId: body.invocation_id ?? "", said: text },
      ]);
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
  // a warm agent. Disabling the button is how that becomes impossible to do by
  // accident rather than a paragraph somebody skips.
  const ready = state === "ready" && Boolean(sessionId);

  const queued = useMemo(
    () => new Set(events.filter((e) => e.kind === "queued").map((e) => e.invocation_id)),
    [events],
  );
  const ended = useMemo(
    () =>
      new Set(
        events
          .filter((e) => e.kind === "finished" || e.kind === "error")
          .map((e) => e.invocation_id),
      ),
    [events],
  );

  return (
    <div className="chat">
      <header className="chat-head">
        <span className="agent">{agent}</span>
        <span className={`state state-${state}`}>{state}</span>
      </header>

      <div className="transcript">
        {turns.length === 0 && (
          <p className="empty">Say something to {agent}.</p>
        )}

        {turns.map((turn) => {
          const spoken = spokenIn(events, turn.invocationId);
          const failed = events.find(
            (e) => e.invocation_id === turn.invocationId && e.kind === "error",
          );
          return (
            <article key={turn.invocationId || turn.said} className="turn">
              <p className="mine">{turn.said}</p>

              {/* THE ONE EVENT rt-service SENDS ITSELF, because a scaled-to-zero
                  agent has no pod to send one. Saying so is what stops a cold
                  start — a KEDA poll, a node, a sandbox, an ADK import — reading
                  as a hang. */}
              {!spoken && !failed && queued.has(turn.invocationId) && (
                <p className="waiting">
                  queued — a sleeping agent is scheduled and started before it
                  reads its queue, so the first reply after a quiet period is
                  the slow one.
                </p>
              )}

              {spoken && (
                <p className="theirs">
                  <span className="author">
                    {whoSpoke(events, turn.invocationId)}
                  </span>
                  {spoken}
                </p>
              )}

              {failed && <p className="failed">{textOf(failed)}</p>}

              {/* A PAUSE IS NOT A FAILURE AND NOT SILENCE. It is the run
                  stopping to ask, and it is answered by a different call for
                  each kind — which is why the card is its own component. */}
              <Approvals
                sessionId={sessionId}
                invocationId={turn.invocationId}
                events={events}
                settled={ended.has(turn.invocationId)}
              />
            </article>
          );
        })}
        <div ref={bottom} />
      </div>

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
