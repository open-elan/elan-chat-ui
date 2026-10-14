/**
 * Mint the browser's credential.
 *
 * ── A TICKET, NOT A TOKEN, AND NOT A CACHED STRING ───────────────────────────
 *
 * A ticket is short-lived (~300s) and opens `/ws` for ONE end user. The browser
 * asks this route again on every connect, which is why `elan-sdk/react` takes a
 * ticket SUPPLIER rather than a ticket: a socket that reconnects an hour later
 * would otherwise replay a dead one and be closed `1008`.
 *
 * ── THE CALLER DOES NOT GET TO SAY WHO THEY ARE ──────────────────────────────
 *
 * The end user comes from the signed httpOnly cookie, never from the request
 * body. Accepting an `end_user_id` field here — one line, and the obvious
 * shortcut — would let any visitor mint a ticket for anybody and watch their
 * conversations.
 */

import { NextResponse } from "next/server";

import { elan, originOf } from "@/lib/elan";
import { read } from "@/lib/identity";

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  try {
    const minted = await elan().tickets.mint(who.userId, {
      origin: originOf(request),
    });
    // ONLY THE TICKET AND ITS LIFETIME. The service user's token, which this
    // route used to get here, must not travel with it.
    return NextResponse.json({
      ticket: minted.ticket,
      expires_in: minted.expires_in,
    });
  } catch (error) {
    // The platform's refusals are already written for a developer, so they are
    // passed through rather than flattened into "something went wrong".
    const message = error instanceof Error ? error.message : String(error);
    console.error("could not mint a ticket:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
