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

import { permissionsChanged } from "@/lib/changed";

/** The payload key that marks the engine's own terminal pause. */
const PAUSE_IS_TERMINAL = "interrupt_kind";

/**
 * Three marks, drawn inline.
 *
 * NO ICON LIBRARY FOR THREE GLYPHS, and no font character either: an emoji or
 * a dingbat renders differently on every platform and sometimes not at all.
 * These are paths.
 *
 * `currentColor` SO THEY FOLLOW THE BUTTON. Approve is dark-on-green, reject
 * and always are muted on transparent, and each changes on hover and disable —
 * a fixed fill would be wrong in at least one of those states.
 *
 * `aria-hidden` BECAUSE THE LABEL IS ALREADY THERE. Each button says what it
 * does in words; announcing "check mark Approve" is worse than "Approve".
 */
function Mark({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="mark"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const Tick = () => <Mark><path d="M3 8.5 6.5 12 13 4" /></Mark>;
const Cross = () => <Mark><path d="M4 4l8 8M12 4l-8 8" /></Mark>;
/* TWO TICKS for "always": the same mark as approve, said twice. A standing
   grant is the only choice here that outlives this turn, so it reads as more
   of the same action rather than as a different one. */
const Ticks = () => (
  <Mark>
    <path d="M1 8.5 4 11.5 9.5 4" />
    <path d="M6.5 8.5 9.5 11.5 15 4" />
  </Mark>
);

/**
 * How long to keep looking for the batch, and why there is a schedule at all.
 *
 * THE BROWSER LEARNS OF THE PAUSE BEFORE THE ACTION ROW EXISTS. The engine
 * emits `action_requested` BEFORE the terminal `paused`, and both travel the
 * same ordered topic — but to different consumers. rt-service RELAYS the pause
 * straight down this socket; actions-service has to handle its own copy and
 * COMMIT a row. So the relay normally wins, and a single fetch fired on the
 * pause asks for something that does not exist yet.
 *
 * The failure that causes is the quiet kind: a card rendering its pause message
 * with no Approve button, no error, and nothing to suggest the agent asked
 * anything — indistinguishable from an agent that never asks. Which is exactly
 * what the missing `scope: "tenant"` looked like, so it is worth not shipping
 * the same symptom twice for a different reason.
 */
const LOOK_AGAIN_MS = [0, 250, 500, 1000, 2000, 4000];

interface Waiting {
  kind: string;
  message: string;
  interruptId: string;
}

interface Batch {
  batch_id: string;
  actions: { action_id: string; tool: string; hint: string }[];
}

/** Only what this card needs of a tool's declaration. */
interface Declared {
  ceiling: string | null;
}

/**
 * Whether a standing grant on this tool would actually change anything.
 *
 * A GRANT IS STORED UNCLAMPED AND CLAMPED ON EVERY READ. `approve_all` writes
 * `tier: "t2"`, and the resolver holds that down to the tool's declared
 * `ceiling` — a caller's own ceiling is stripped on the way in, so the
 * author's always wins. On a tool capped at `t1` the row is written, the API
 * answers 200, and the agent goes on asking about the very thing somebody just
 * said always to allow.
 *
 * UNKNOWN COUNTS AS FREEABLE. A target deployed before declarations were
 * recorded has none, and hiding the option everywhere would be a worse answer
 * than offering one that may be capped — the grant is still correct, still
 * revocable, and the honest failure is visible in Action settings.
 */
function freeable(declared: Record<string, Declared> | null, tool: string): boolean {
  const ceiling = declared?.[tool]?.ceiling;
  return !ceiling || ceiling === "t2";
}

function pauseIn(events: readonly AgentEvent[], invocationId: string): Waiting | null {
  // ── A PAUSE SOMEBODY ANSWERED IS NOT A PAUSE ────────────────────────────
  //
  // The resume's events carry the interrupt id as their `segment`, so their
  // presence IS the answer — no status call, no second source of truth.
  //
  // This used to be covered for free and is not any more: the caller passed
  // `settled` from its own turn, and a run's two halves were one turn, so the
  // continuation's `finished` cleared the panel. They are two bubbles now, by
  // design, and the half holding the pause never finishes — so the amber
  // "someone is reviewing this" panel stayed up underneath the answer that
  // had already arrived.
  const answered = new Set(
    events
      .filter((event) => event.invocation_id === invocationId && event.segment)
      .map((event) => event.segment),
  );

  // THE DISCRIMINATOR IS THE PAYLOAD KEY, not the position or the count.
  for (const event of events) {
    if (event.invocation_id !== invocationId || event.kind !== "paused") continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (!(PAUSE_IS_TERMINAL in payload)) continue;
    const interruptId = String(payload["interrupt_id"] ?? "");
    if (answered.has(interruptId)) continue;
    return {
      kind: String(payload[PAUSE_IS_TERMINAL] ?? ""),
      // The engine copies the node's prompt onto the terminal payload for
      // exactly this reader — only the FIRST paused event carries it, so a
      // client reading the last event it saw would otherwise show fallback copy.
      message: String(payload["message"] ?? ""),
      interruptId,
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
  const [declared, setDeclared] = useState<Record<string, Declared> | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [missing, setMissing] = useState("");
  /**
   * Batches this card has already answered, by id.
   *
   * A DECISION IS NOT UNDOABLE AND THE BUTTONS MUST SAY SO. `busy` goes back
   * to false the moment the request returns, so without this the card sat
   * there with Approve live and nothing to show it had been pressed — and the
   * run can take tens of seconds to visibly continue, because a pause is
   * exactly the quiet period that lets a scale-to-zero pod go away. A second
   * press in that window is a 404: the action is no longer pending, which is
   * the right answer to the wrong question.
   */
  const [decided, setDecided] = useState<Record<string, string>>({});

  // CONFIRMATIONS COME FROM THE SERVER, because `/v1/actions` refuses a ticket
  // — a decision causes a tool to run, so it is a privileged read and write.
  // ANY OF THREE KINDS CAN CARRY ONE, which is why this does not test for the
  // kind that names it. A turn raising both a confirmation and something
  // longer-running reports the LONGER-LIVED kind — `approval`, else `tool` —
  // because the pause kind is a single word over a mixed turn and the payload
  // is what is authoritative. Testing for "confirmation" therefore dropped the
  // user's own card whenever anything outranked it.
  useEffect(() => {
    if (!waiting || waiting.kind === "input" || settled) return;
    let current = true;
    setMissing("");

    void (async () => {
      // AFTER A DECISION, ONE LOOK AND NO COMPLAINT. An empty result then is
      // the EXPECTED outcome — the batch was answered and is no longer pending
      // — so running the retry schedule would end in a warning about a card
      // that had just worked perfectly well.
      const schedule = said ? [0] : LOOK_AGAIN_MS;

      for (const pause of schedule) {
        if (pause) await new Promise((done) => setTimeout(done, pause));
        if (!current) return;

        const answer = await fetch(
          `/api/approvals?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!current) return;

        if (!answer.ok) {
          // A REFUSAL IS NOT A RACE and must not be retried into silence: 401,
          // 400 and 404 all mean the next five attempts fail identically.
          const body = (await answer.json().catch(() => ({}))) as { error?: string };
          if (current) {
            setMissing(body.error || `could not list approvals (${answer.status})`);
          }
          return;
        }

        const body = (await answer.json()) as {
          batches?: Batch[];
          declared?: Record<string, Declared> | null;
        };
        const found = body.batches ?? [];
        if (!current) return;
        if (found.length > 0) {
          setBatches(found);
          setDeclared(body.declared ?? null);
          return;
        }
      }

      // GIVING UP IS SAID OUT LOUD. Nothing pending after several seconds is
      // either a batch somebody answered elsewhere or one that never landed,
      // and both deserve a sentence rather than a card with no buttons.
      // AND COMPLAIN ONLY WHERE ONE WAS DUE. A `confirmation` pause means a
      // card belongs to the person reading this, so finding none is wrong and
      // worth saying. An `approval` or `tool` pause routinely has nothing for
      // them — it is waiting on somebody else — and the note below says so.
      if (current && !said && waiting.kind === "confirmation") {
        setBatches([]);
        setMissing(
          "This run is waiting on an approval that has not appeared in the " +
            "actions store. Reload to look again.",
        );
      }
    })();

    return () => {
      current = false;
    };
  }, [waiting, settled, sessionId, said]);

  const decide = useCallback(
    async (batch: Batch, approved: boolean, always = false) => {
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
            approveAll: always,
          }),
        });
        const body = (await answer.json()) as {
          published?: boolean;
          granted?: boolean;
          error?: string;
        };
        if (!answer.ok) {
          setSaid(body.error || `refused (${answer.status})`);
          return;
        }
        // RECORDED ONLY ON SUCCESS, so a refusal leaves the buttons live and
        // the decision retryable — which is the whole difference between
        // "this is done" and "this did not go through".
        // THE SETTINGS PANEL IS A DIFFERENT COMPONENT and would otherwise go
        // on reporting "as the agent ships" for a grant just made.
        if (body.granted) permissionsChanged();
        setDecided((was) => ({
          ...was,
          [batch.batch_id]: always && body.granted
            ? "Approved, and it will not ask again"
            : approved ? "Approved" : "Rejected",
        }));
        // `published` IS WHAT SAYS ANYTHING RAN. The decision is recorded
        // either way, and a batch with members still outstanding publishes
        // nothing yet.
        setSaid(
          body.published
            ? approved
              ? always && body.granted
                ? "approved — and this agent will act on its own next time. Change that in Action settings."
                : "approved — the run is continuing"
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

      {/* THE CARDS THEMSELVES ARE EVIDENCE THAT THEY BELONG HERE. The fetch
          above only returns confirmations this person may decide, so having
          one IS the condition — and gating on the kind again would fetch a
          mixed turn's card and then refuse to draw it. */}
      {batches.map((batch) => (
          <div key={batch.batch_id} className="pause-act">
            <ul className="tools">
              {batch.actions.map((action) => (
                <li key={action.action_id}>
                  <code>{action.tool}</code>
                  {action.hint ? ` — ${action.hint}` : ""}
                </li>
              ))}
            </ul>
            {!decided[batch.batch_id] &&
              batch.actions.some((action) => !freeable(declared, action.tool)) && (
                // NAMED, NOT HIDDEN. Silently leaving these out of "always"
                // means somebody grants it, sees the agent ask again, and has
                // no way to tell a cap from a bug.
                <p className="pause-note">
                  {batch.actions
                    .filter((action) => !freeable(declared, action.tool))
                    .map((action) => action.tool)
                    .join(", ")}{" "}
                  will keep asking whatever you choose — the agent caps it.
                </p>
              )}

            {decided[batch.batch_id] ? (
              // THE ANSWER, NOT THE QUESTION. The card stays mounted until the
              // run emits a terminal event, which is after the agent has
              // actually continued — so this is what fills that gap.
              <p className="pause-decided">
                {decided[batch.batch_id]} · waiting for the agent to continue
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void decide(batch, true)}
                  disabled={busy}
                >
                  <Tick />
                  {busy ? "Sending…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="reject"
                  onClick={() => void decide(batch, false)}
                  disabled={busy}
                >
                  <Cross />
                  Reject
                </button>

                {/* OFFERED ONLY WHERE IT WOULD DO SOMETHING. A standing grant
                    on a tool the author capped is written, accepted, and then
                    clamped on every read — so the button would promise a thing
                    the agent goes on not doing. */}
                {batch.actions.some((action) => freeable(declared, action.tool)) && (
                  <button
                    type="button"
                    className="always"
                    onClick={() => void decide(batch, true, true)}
                    disabled={busy}
                  >
                    <Ticks />
                    Always approve
                  </button>
                )}
              </>
            )}
          </div>
        ))}

      {waiting.kind === "approval" && batches.length === 0 && (
        <p className="pause-note">
          Someone at the organisation is reviewing this request. You do not
          need to do anything — the request waits even if you carry on
          talking, and the agent will tell you what was decided.
        </p>
      )}

      {waiting.kind === "tool" && (
        <p className="pause-note">
          An external system owes this run a result. A person cannot answer it —
          your backend submits one with <code>elan.tools.submit(callId, …)</code>,
          and a deadline abandons the call with an error if nobody does.
        </p>
      )}

      {missing && <p className="pause-note">{missing}</p>}
      {said && <p className="pause-note">{said}</p>}
    </section>
  );
}
