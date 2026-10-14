/**
 * Turning a thrown thing into a status a reader can act on.
 *
 * ── WHY THIS IS NOT JUST `502` ───────────────────────────────────────────────
 *
 * The first version answered `502` for everything, and the very first request
 * it ever served returned `502 ELAN_CLIENT_ID is not set` — a status that sends
 * you to look at the platform for a problem in your own `.env.local`. The
 * message was right and the status argued with it.
 *
 * So a configuration fault is `500` (this app is misconfigured), a refusal for
 * funds is `402` (settle and try again), a lost race is `409` (retrying will
 * not help), and only an actual failure to reach the platform is `502`.
 */

import { NextResponse } from "next/server";

/** Something this app was not given. Not the platform's fault. */
export class ConfigError extends Error {}

export function failed(what: string, error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${what}:`, message);

  if (error instanceof ConfigError) {
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (/insufficient|payment required|402/i.test(message)) {
    // The end user's wallet, or the tenant's balance, will not cover it. A
    // resumed turn reserves on its own merits, so this can happen on a resume
    // where the first turn went through.
    return NextResponse.json({ error: message }, { status: 402 });
  }
  if (/conflict|already decided|not pending|409/i.test(message)) {
    // Somebody — or the engine's own abandonment — got there first. Retrying
    // does not help, and would not be idempotent if it did.
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 502 });
}
