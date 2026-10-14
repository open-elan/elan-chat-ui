/**
 * The approvals a run is waiting on, and answering them.
 *
 * ── WHY THIS IS A SERVER ROUTE ───────────────────────────────────────────────
 *
 * `/v1/actions` and `/v1/actions/{id}/decide` refuse a ticket. A decision is
 * an authorisation — it causes a tool to run — so it is a privileged write and
 * the browser is deliberately not able to make one. The page asks this route.
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

import { elan } from "@/lib/elan";
import { read } from "@/lib/identity";

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
    // SCOPED BY SESSION, which is this conversation. The service user could
    // ask for the tenant's whole inbox; an end user's chat has no business
    // seeing another conversation's approvals.
    const batches = await elan().actions.batches({ sessionId, status: "pending" });
    return NextResponse.json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("could not list approvals:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let actionIds: string[] = [];
  let approved = false;
  let note = "";
  try {
    const body = (await request.json()) as {
      actionIds?: unknown;
      approved?: unknown;
      note?: unknown;
    };
    if (Array.isArray(body.actionIds)) {
      actionIds = body.actionIds.filter((id): id is string => typeof id === "string");
    }
    approved = body.approved === true;
    if (typeof body.note === "string") note = body.note.slice(0, 1000);
  } catch {
    // Handled by the check below.
  }

  if (actionIds.length === 0) {
    return NextResponse.json({ error: "no actionIds" }, { status: 400 });
  }

  try {
    const outcome = await elan().actions.decideBatch(actionIds, { approved, note });
    return NextResponse.json({
      batch_id: outcome.batch_id,
      complete: outcome.complete,
      // NOTHING RAN UNTIL THIS IS TRUE. The decision is recorded either way.
      published: outcome.published,
      decisions: outcome.decisions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("could not decide:", message);
    // A 409 means somebody — or the engine's own abandonment — got there
    // first. Retrying does not help and would not be idempotent if it did.
    const status = /conflict|already|not pending/i.test(message) ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
