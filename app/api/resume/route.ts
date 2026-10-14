/**
 * Answer a workflow that stopped to ask.
 *
 * ── A RESUME CARRIES DATA, NOT JUST CONSENT ──────────────────────────────────
 *
 * `payload` becomes the paused node's own OUTPUT, verbatim, and flows to the
 * next node as its input — so a node that asked for a cost centre or a
 * corrected address can be answered with one. `approved`, `note` and the
 * decider are set by the service and keep precedence over anything sent here:
 * attribution for a human decision must not be forgeable, which is the whole
 * point of having a human in the loop.
 *
 * ── YOU STATE ONLY YOUR ANSWER ───────────────────────────────────────────────
 *
 * Which workflow, whose session and which interrupt all come from the RECORDED
 * run, so guessing an invocation id gets you nothing. This route does not pass
 * them and could not.
 *
 * ── AND IT CAN BE REFUSED FOR FUNDS WHERE THE FIRST TURN WAS NOT ─────────────
 *
 * A pause settles what the turn used and releases the rest, so nothing is held
 * across a wait of any length — and the resumed turn therefore reserves on its
 * own merits. If the balance ran out in between, this answers 402 and the graph
 * does not continue.
 */

import { NextResponse } from "next/server";

import { elan } from "@/lib/elan";
import { read } from "@/lib/identity";

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let invocationId = "";
  let approved = false;
  let note = "";
  let payload: Record<string, unknown> | undefined;
  try {
    const body = (await request.json()) as {
      invocationId?: unknown;
      approved?: unknown;
      note?: unknown;
      payload?: unknown;
    };
    if (typeof body.invocationId === "string") invocationId = body.invocationId;
    approved = body.approved === true;
    if (typeof body.note === "string") note = body.note.slice(0, 1000);
    if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
      payload = body.payload as Record<string, unknown>;
    }
  } catch {
    // Handled below.
  }

  if (!invocationId) {
    return NextResponse.json({ error: "no invocationId" }, { status: 400 });
  }

  try {
    const accepted = await elan().runtime.resume(invocationId, {
      approved,
      note,
      ...(payload ? { payload } : {}),
    });
    // 202 AGAIN. The continuation arrives on the browser's socket, as the
    // first turn did — and under the same `invocation_id`, with `segment` set
    // to the interrupt id so the two halves do not collide.
    return NextResponse.json({ invocation_id: accepted.invocation_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("could not resume:", message);
    const status = /insufficient|payment/i.test(message) ? 402 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
