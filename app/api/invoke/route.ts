/**
 * Send the agent a message.
 *
 * ── THE ORDERING IS THE BROWSER'S JOB, NOT THIS ROUTE'S ──────────────────────
 *
 * Pub/Sub discards a message published to a topic with no subscription, and
 * rt-service creates the tenant's subscription when its FIRST socket opens. So
 * something must be listening before this route publishes — and in this app
 * that is the browser's socket, which `ElanProvider` opened when the page
 * loaded. The UI disables the composer until the stream reports `ready` for
 * exactly this reason.
 *
 * That is also why this route does NOT open a stream of its own. The SDK's
 * `runtime.run()` does the whole subscribe-invoke-collect dance and is the
 * right call from a worker; here it would subscribe as the SERVICE USER and
 * wait out its timeout, because...
 *
 * ── `end_user_id` SENDS THE EVENTS SOMEWHERE ELSE, ON PURPOSE ────────────────
 *
 * Naming an end user addresses the run's events to `eu:<id>` — to THEM, not to
 * whoever published it. A backend that invokes for its customer and then waits
 * on its own socket reports a five-minute silence about a run that worked
 * perfectly; the SDK raises `EndUserEventsElsewhere` to catch that.
 *
 * This app is the shape that trap describes as correct: the server invokes
 * naming the end user, and the browser holds a ticket for the SAME end user,
 * which is why the reply arrives in the page.
 */

import { NextResponse } from "next/server";

import { elan, target } from "@/lib/elan";
import { read } from "@/lib/identity";

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let text = "";
  let sessionId = "";
  try {
    const body = (await request.json()) as { text?: unknown; sessionId?: unknown };
    if (typeof body.text === "string") text = body.text.trim();
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
  } catch {
    // Falls through to the checks below, which name the missing field.
  }

  // `text` IS REQUIRED AND NON-EMPTY by the service (min_length=1), so an
  // empty message is a 422 from the platform rather than an empty turn.
  if (!text) {
    return NextResponse.json({ error: "say something" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "no sessionId" }, { status: 400 });
  }

  try {
    const started = await elan().runtime.invoke(target(), text, {
      sessionId,
      endUserId: who.userId,
    });
    // 202, AND NOTHING HAS RUN. There is no reply in this response and there
    // is no route that would give one — it arrives on the browser's socket.
    return NextResponse.json({
      invocation_id: started.invocation_id,
      message_id: started.message_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("could not invoke:", message);
    // A 402 here means the end user's wallet (or the tenant's balance) will
    // not cover the run, which is a thing the UI should say plainly rather
    // than retry.
    const status = /insufficient|payment/i.test(message) ? 402 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
