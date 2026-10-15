"use client";

/**
 * What a paused run is waiting for, and how to answer it.
 *
 * ── THREE KINDS OF PAUSE, THREE DIFFERENT ANSWERS ────────────────────────────
 *
 *   input         a workflow node wants a VALUE      → resume with a payload
 *   confirmation  a person must approve a tool call  → decide the BATCH
 *   tool          an external system owes a RESULT   → your backend submits it
 *
 * Sending somebody to the wrong one costs them the afternoon, so the card asks
 * which kind it is rather than offering one pair of buttons for all three.
 *
 * ── A PAUSED RUN EMITS TWO `paused` EVENTS AND NO `finished` AT ALL ───────────
 *
 * The pause IS where the run stopped, deliberately: the push handler acks
 * there, because a human approval can outlast any ack deadline. So a client
 * waiting for a terminal kind waits for something that never comes.
 *
 * Of the two, only the engine's SYNTHESISED one carries `interrupt_kind` —
 * ADK's own is its event dumped whole and names no interrupt. That key is the
 * discriminator, and it is not a positional rule: a `content` event can sit
 * BETWEEN the two pauses, so "the last paused" is wrong too.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentEvent } from "elan-sdk";

/** The payload key that marks the engine's own terminal pause. */
const PAUSE_IS_TERMINAL = "interrupt_kind";

interface Waiting {
  kind: string;
  message: string;
  interruptId: string;
}

interface Batch {
  batch_id: string;
  actions: { action_id: string; tool: string; hint: string }[];
}

function pauseIn(events: readonly AgentEvent[], invocationId: string): Waiting | null {
  // THE DISCRIMINATOR IS THE PAYLOAD KEY, not the position or the count.
  for (const event of events) {
    if (event.invocation_id !== invocationId || event.kind !== "paused") continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (!(PAUSE_IS_TERMINAL in payload)) continue;
    return {
      kind: String(payload[PAUSE_IS_TERMINAL] ?? ""),
      // The engine copies the node's prompt onto the terminal payload for
      // exactly this reader — only the FIRST paused event carries it, so a
      // client reading the last event it saw would otherwise show fallback copy.
      message: String(payload["message"] ?? ""),
      interruptId: String(payload["interrupt_id"] ?? ""),
    };
  }
  return null;
}

export function Approvals({
  sessionId,
  invocationId,
  events,
  settled,
}: {
  sessionId: string;
  invocationId: string;
  events: readonly AgentEvent[];
  settled: boolean;
}) {
  const waiting = useMemo(() => pauseIn(events, invocationId), [events, invocationId]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  // CONFIRMATIONS COME FROM THE SERVER, because `/v1/actions` refuses a ticket
  // — a decision causes a tool to run, so it is a privileged read and write.
  useEffect(() => {
    if (!waiting || waiting.kind !== "confirmation" || settled) return;
    let current = true;
    void (async () => {
      const answer = await fetch(
        `/api/approvals?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!answer.ok || !current) return;
      const body = (await answer.json()) as { batches?: Batch[] };
      if (current) setBatches(body.batches ?? []);
    })();
    return () => {
      current = false;
    };
  }, [waiting, settled, sessionId, said]);

  const decide = useCallback(
    async (batch: Batch, approved: boolean) => {
      setBusy(true);
      try {
        const answer = await fetch("/api/approvals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // THE SESSION TRAVELS WITH THE DECISION, because the server proves
            // the action belongs to this caller against it.
            sessionId,
            // THE WHOLE BATCH, never one member. The next message resolves
            // every confirmation a turn raised, so answering one of two
            // silently abandons the other while the run reports finished.
            actionIds: batch.actions.map((action) => action.action_id),
            approved,
          }),
        });
        const body = (await answer.json()) as {
          published?: boolean;
          error?: string;
        };
        if (!answer.ok) {
          setSaid(body.error || `refused (${answer.status})`);
          return;
        }
        // `published` IS WHAT SAYS ANYTHING RAN. The decision is recorded
        // either way, and a batch with members still outstanding publishes
        // nothing yet.
        setSaid(
          body.published
            ? approved
              ? "approved — the run is continuing"
              : "rejected — the run is continuing"
            : "recorded; this turn has other members still outstanding",
        );
      } finally {
        setBusy(false);
      }
    },
    // `sessionId` IS A DEPENDENCY NOW. It was `[]` when this closed over
    // nothing but its argument; a stale empty-dep callback would send the
    // session of whichever conversation was open when it was first created.
    [sessionId],
  );

  const answer = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invocationId,
          approved: true,
          // BECOMES THE PAUSED NODE'S OWN OUTPUT, verbatim, and flows to the
          // next node — so this is data, not just consent.
          payload: { value },
        }),
      });
      const body = (await response.json()) as { error?: string };
      setSaid(response.ok ? "sent — the run is continuing" : body.error || "refused");
      if (response.ok) setValue("");
    } finally {
      setBusy(false);
    }
  }, [invocationId, value]);

  if (!waiting || settled) return null;

  return (
    <section className="pause">
      <p className="pause-why">
        <span className="pause-kind">{waiting.kind || "paused"}</span>
        {waiting.message || "This run is waiting."}
      </p>

      {waiting.kind === "input" && (
        <div className="pause-act">
          <input
            value={value}
            onChange={(changed) => setValue(changed.target.value)}
            placeholder="Your answer…"
            disabled={busy}
            aria-label="Your answer"
          />
          <button type="button" onClick={() => void answer()} disabled={busy || !value.trim()}>
            Send
          </button>
        </div>
      )}

      {waiting.kind === "confirmation" &&
        batches.map((batch) => (
          <div key={batch.batch_id} className="pause-act">
            <ul className="tools">
              {batch.actions.map((action) => (
                <li key={action.action_id}>
                  <code>{action.tool}</code>
                  {action.hint ? ` — ${action.hint}` : ""}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void decide(batch, true)} disabled={busy}>
              Approve
            </button>
            <button
              type="button"
              className="reject"
              onClick={() => void decide(batch, false)}
              disabled={busy}
            >
              Reject
            </button>
          </div>
        ))}

      {waiting.kind === "tool" && (
        <p className="pause-note">
          An external system owes this run a result. A person cannot answer it —
          your backend submits one with <code>elan.tools.submit(callId, …)</code>,
          and a deadline abandons the call with an error if nobody does.
        </p>
      )}

      {said && <p className="pause-note">{said}</p>}
    </section>
  );
}
