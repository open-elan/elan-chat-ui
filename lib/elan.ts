/**
 * The server's client, and the only thing in this app that holds a secret.
 *
 * ── WHY THERE ARE TWO TIERS AT ALL (ADR-0117) ────────────────────────────────
 *
 * A TICKET OPENS `/ws` AND NOTHING ELSE. Every other route answers 403. So a
 * browser can WATCH a run and cannot start one, cannot list approvals, cannot
 * decide one, and cannot read a run back. Everything that ACTS therefore
 * happens here, in a route handler, with a service user's credentials.
 *
 * THE BROWSER NEVER SEES THESE VALUES, and that is structural rather than
 * careful: Next only exposes environment variables prefixed `NEXT_PUBLIC_` to
 * the client bundle, and none of these are. A reader copying this file cannot
 * accidentally ship the secret by importing it from a component — the build
 * would inline `undefined`.
 */

import { ElanClient } from "elan-sdk";

import { ConfigError } from "./failure";

function required(name: string): string {
  const found = process.env[name];
  if (!found) {
    throw new ConfigError(
      `${name} is not set. Copy .env.example to .env.local and fill it in; ` +
        `a service user comes from the console's API access page, or ` +
        `POST /v1/projects/{project}/service-users.`,
    );
  }
  return found;
}

/**
 * ONE CLIENT PER PROCESS, because it caches the access token.
 *
 * `clientCredentials` refreshes BEFORE a token expires rather than after a
 * 401, and a client built per request would throw that cache away and mint a
 * token for every message somebody types.
 */
let held: ElanClient | undefined;

export function elan(): ElanClient {
  if (!held) {
    held = new ElanClient({
      baseUrl: required("ELAN_API_URL"),
      project: required("ELAN_PROJECT"),
      clientId: required("ELAN_CLIENT_ID"),
      clientSecret: required("ELAN_CLIENT_SECRET"),
    });
  }
  return held;
}

/** Which agent this chat talks to. */
export function target(): string {
  return required("ELAN_TARGET");
}

/**
 * The origin to mint a ticket for, taken from the REQUEST.
 *
 * PINNED EXACTLY, AND A SUFFIX DOES NOT COUNT. rt-service compares the
 * socket's `Origin` header against the one the ticket was minted for, so a
 * ticket minted for `https://example.com` is refused from
 * `https://evil.example.com` — and the refusal arrives as a `1008` close on
 * connect rather than an error at mint, which is a long way from the mistake.
 *
 * Read from the request instead of configured, so the example works on
 * localhost and behind a real hostname with no setting to get wrong.
 */
export function originOf(request: Request): string {
  const header = request.headers.get("origin");
  if (header) return header;
  // No `Origin` on a same-origin POST from some clients; the URL is the
  // honest fallback and is still this app's own origin.
  return new URL(request.url).origin;
}
