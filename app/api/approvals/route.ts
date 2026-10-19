/**
 * The approvals a run is waiting on, and answering them.
 *
 * ── WHY THIS IS A SERVER ROUTE ───────────────────────────────────────────────
 *
 * `/v1/actions` and `/v1/actions/{id}/decide` refuse a ticket. A decision is
 * an authorisation — it causes a tool to run — so it is a privileged write and
 * the browser is deliberately not able to make one. The page asks this route.
 *
 * ── `scope: "tenant"`, AND IT IS NOT OPTIONAL HERE ───────────────────────────
 *
 * A confirmation raised by an END USER's run is recorded against `eu:<id>`, not
 * against the service user that published it. So the default `scope: "mine"`
 * finds NONE of them and the card renders with no Approve button and no error —
 * which is how this read as "the agent never asks". Tenant scope needs admin,
 * which this credential already has: it mints tickets and invokes for end users.
 *
 * ── SO OWNERSHIP IS PROVED, NOT ASSUMED ──────────────────────────────────────
 *
 * Tenant scope returns EVERY end user's actions, and the action row carries no
 * `user_id` to filter on. What it does carry is `invocation_id` — so this reads
 * the session's runs first, checks every one belongs to the caller, and shows
 * or decides only actions whose invocation is in that set. Same proof
 * `/api/history` uses, and the only one the API exposes.
 *
 * WITHOUT IT A GUESSED SESSION ID WOULD BE ENOUGH TO APPROVE SOMEBODY ELSE'S
 * TOOL CALL, which is why this file is longer than it looks like it should be.
 *
 * ── A TURN'S ANSWERS TRAVEL AS ONE BATCH ─────────────────────────────────────
 *
 * One model turn can raise several confirmations, and THE NEXT MESSAGE RESOLVES
 * EVERY ONE IT RAISED. Answer one of two and the other is silently abandoned
 * while the run reports finished. So this decides a BATCH — `decideBatch` —
 * rather than offering a button per action, and the run resumes only when the
 * batch's last member is answered. `published` is what says it actually did.
 *
 * ── AND AN APPROVAL IS NOT A GUARANTEE IT RAN ────────────────────────────────
 *
 * The engine refuses any batch with a later user turn and records it
 * `abandoned` — which is why that status can FOLLOW an approval and means
 * nothing ran. The UI reports it rather than showing a tick.
 */

import { NextResponse } from "next/server";

import { elan, target } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

/**
 * The invocations of this session that belong to the caller.
 *
 * `null` means the session is not theirs — answered the same way as "no such
 * session", because distinguishing the two confirms a guessed id exists.
 */
async function ownedRuns(
  sessionId: string,
  userId: string,
): Promise<Set<string> | null> {
  const mine = `eu:${userId}`;
  const page = await elan().runs.list({ sessionId, limit: 50 });
  if (page.runs.some((run) => run.user_id !== mine)) return null;
  return new Set(page.runs.map((run) => run.invocation_id));
}

export async function GET(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "no sessionId" }, { status: 400 });
  }

  try {
    const owned = await ownedRuns(sessionId, who.userId);
    if (owned === null) {
      return NextResponse.json(
        { error: "no conversation by that id for this identity" },
        { status: 404 },
      );
    }

    const all = await elan().actions.batches({
      sessionId,
      status: "pending",
      // CONFIRMATIONS ONLY. A long-running tool call shares this store and this
      // batch but is answered by a SYSTEM — putting it on an approval card
      // shows work nobody looking at the page can do.
      kind: "confirmation",
      scope: "tenant",
    });

    const batches = all.filter((batch) => owned.has(batch.invocation_id));

    // THE DECLARED CEILING TRAVELS WITH THE CARD, so "always approve" can be
    // offered only where a standing grant would actually take effect. The
    // grant is written UNCLAMPED (`tier: "t2"`) and clamped on every read
    // against the tool's declared ceiling — so offering it on a capped tool
    // writes a row that changes nothing and leaves somebody watching an agent
    // keep asking about a thing they just said always to allow.
    const agent = await elan().agents.get(target());
    return NextResponse.json({
      batches,
      declared: agent?.manifest.action_policies ?? null,
    });
  } catch (error) {
    return failed("could not list approvals", error);
  }
}

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let actionIds: string[] = [];
  let sessionId = "";
  let approved = false;
  let approveAll = false;
  let note = "";
  try {
    const body = (await request.json()) as {
      actionIds?: unknown;
      sessionId?: unknown;
      approved?: unknown;
      approveAll?: unknown;
      note?: unknown;
    };
    if (Array.isArray(body.actionIds)) {
      actionIds = body.actionIds.filter((id): id is string => typeof id === "string");
    }
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
    approved = body.approved === true;
    // ONLY WITH AN APPROVAL. The service ignores it on a rejection, and
    // sending it anyway would read here as though rejecting could grant
    // something.
    approveAll = body.approveAll === true && approved;
    if (typeof body.note === "string") note = body.note.slice(0, 1000);
  } catch {
    // Handled by the check below.
  }

  if (actionIds.length === 0) {
    return NextResponse.json({ error: "no actionIds" }, { status: 400 });
  }
  // REQUIRED ON A DECISION, AND IT WAS NOT. Without the session there is
  // nothing to prove the action belongs to the caller against — an action id
  // alone would have been enough to approve a stranger's tool call.
  if (!sessionId) {
    return NextResponse.json({ error: "no sessionId" }, { status: 400 });
  }

  try {
    const owned = await ownedRuns(sessionId, who.userId);
    if (owned === null) {
      return NextResponse.json(
        { error: "no conversation by that id for this identity" },
        { status: 404 },
      );
    }

    // EVERY ID CHECKED AGAINST THIS SESSION'S OWN PENDING ACTIONS, so one from
    // another conversation cannot be smuggled into a batch the caller does own.
    const batches = await elan().actions.batches({
      sessionId, status: "pending", kind: "confirmation", scope: "tenant",
    });
    const allowed = new Set(
      batches
        .filter((batch) => owned.has(batch.invocation_id))
        .flatMap((batch) => batch.actions.map((action) => action.action_id)),
    );
    const stranger = actionIds.find((id) => !allowed.has(id));
    if (stranger) {
      return NextResponse.json(
        { error: "that action is not pending in this conversation" },
        { status: 404 },
      );
    }

    // APPLIED PER ACTION, which is what a mixed turn needs: the SDK decides
    // each member in order and each one's own tool gets its own standing
    // grant. The grant is written against WHOSE CARD IT WAS — the end user —
    // and not against this service user, which is the only reading that makes
    // "stop asking me" mean the person who said it.
    const outcome = await elan().actions.decideBatch(actionIds, {
      approved, note, approveAll,
    });
    return NextResponse.json({
      batch_id: outcome.batch_id,
      complete: outcome.complete,
      // NOTHING RAN UNTIL THIS IS TRUE. The decision is recorded either way.
      published: outcome.published,
      decisions: outcome.decisions,
      // THE STANDING GRANT, not this decision. Absent when none was asked for
      // or when recording one failed — which does NOT undo the approval.
      granted: outcome.decisions.some((decision) => decision.rule_id),
    });
  } catch (error) {
    // A 409 means somebody — or the engine's own abandonment — got there
    // first. Retrying does not help and would not be idempotent if it did;
    // `failed` is where that mapping lives.
    return failed("could not decide", error);
  }
}
