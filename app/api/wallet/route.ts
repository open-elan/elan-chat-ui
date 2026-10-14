/**
 * What this end user has left, and what they have spent.
 *
 * ── THROUGH THE PUBLIC API, NEVER AT THE LEDGER ──────────────────────────────
 *
 * ADR-0114 is explicit that an example must not reach `/ledger` or
 * `/observability`: the one host that exposed those prefixes was deleted for
 * it, and an example is where a shortcut gets copied from. This does not.
 * `wallets.get` and `wallets.statement` are deploy-service routes
 * (`/v1/projects/{project}/wallets/...`) — the authenticated door, which checks
 * a token and scopes to a project. ledger-service is not publicly routed at
 * all and nothing here knows its name.
 *
 * ── A SERVER ROUTE, FOR THE USUAL REASON ─────────────────────────────────────
 *
 * A ticket opens `/ws` and nothing else, so the browser cannot read a wallet.
 * And the id read is the CALLER'S OWN, taken from the signed cookie — never
 * from a query parameter, or any visitor could read anybody's balance and
 * statement. Same property as `/api/ticket`.
 *
 * ── READ-ONLY, AND STRUCTURALLY SO ───────────────────────────────────────────
 *
 * `elan.wallets` is the SDK's read object and issues no non-GET; the writes
 * live on `elan.credit`, which this app never touches. Topping up is an
 * administrative act on the tenant's own customers, not something a chat UI
 * does on behalf of whoever is looking at it.
 */

import { NextResponse } from "next/server";
import { NotFound, NotWired } from "elan-sdk";

import { elan } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

/** How much of the statement to show. The newest entries are the ones read. */
const ENTRIES = 20;

export async function GET() {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  try {
    // BOTH AT ONCE. They are two routes and one question, and a statement
    // rendered a second after the balance it belongs to reads as a flicker.
    const [wallet, statement] = await Promise.all([
      elan().wallets.get(who.userId),
      elan().wallets.statement(who.userId, { limit: ENTRIES }),
    ]);
    return NextResponse.json({
      wallet,
      entries: statement.entries,
      total: statement.total,
    });
  } catch (error) {
    // NO WALLET IS A STATE, NOT A FAILURE, and it is the state every demo
    // starts in: a wallet exists only because somebody opened one. Saying
    // "could not reach the platform" here would send a reader to check their
    // credentials when the answer is `elan wallet new <id>`.
    if (error instanceof NotFound) {
      return NextResponse.json({ wallet: null, entries: [], total: 0 });
    }
    // And a deployment with no ledger wired is a configuration, not a fault.
    if (error instanceof NotWired) {
      return NextResponse.json({
        wallet: null,
        entries: [],
        total: 0,
        unavailable: "this deployment has no ledger configured, so there is " +
          "nothing to show. Runs still work; they are charged to the tenant.",
      });
    }
    return failed("could not read the wallet", error);
  }
}
