/**
 * This end user's connected accounts: list them, and disconnect one.
 *
 * ── HOW SOMEBODY "LOGS OUT" OF A THIRD PARTY'S MCP SERVER ───────────────────
 *
 * The platform holds their tokens (ADR-0260), so signing out is deleting them
 * there: the next run that needs the account pauses and asks them to connect
 * again. Revoking this app's grant at the provider itself is theirs, from the
 * provider's own settings — the platform cannot do it for them.
 *
 * ── A SERVER ROUTE, BECAUSE A TICKET CANNOT ──────────────────────────────────
 *
 * A ticket opens `/ws` and starts a sign-in for its own user, and nothing
 * else: listing and disconnecting are refused to it. The service user may,
 * for any end user it names — which is why the name comes from the signed
 * cookie and never from the request, or any visitor could disconnect anybody.
 */

import { NextResponse } from "next/server";
import { NotWired } from "elan-sdk";

import { elan } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

export async function GET() {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  try {
    const connections = await elan().connections.list({ endUserId: who.userId });
    return NextResponse.json({ connections });
  } catch (error) {
    // A platform with connected accounts switched off has none to show: a
    // configuration, not a fault.
    if (error instanceof NotWired) {
      return NextResponse.json({ connections: [] });
    }
    return failed("could not list connected accounts", error);
  }
}

export async function DELETE(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const { name } = (await request.json().catch(() => ({}))) as { name?: string };
  if (!name) {
    return NextResponse.json({ error: "which account?" }, { status: 400 });
  }
  try {
    await elan().connections.disconnect(name, { endUserId: who.userId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return failed(`could not disconnect ${name}`, error);
  }
}
