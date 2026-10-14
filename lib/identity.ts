/**
 * Who the visitor is, decided by the SERVER and never by the browser.
 *
 * ── THE PROPERTY THIS FILE EXISTS FOR (ADR-0117) ─────────────────────────────
 *
 * A ticket is minted FOR an end user, and whoever holds it sees that end
 * user's runs. So if the browser could name its own `end_user_id` — one extra
 * field on the request to `/api/ticket` — any visitor could mint a ticket for
 * anybody and watch their conversations.
 *
 * The identity therefore travels in an httpOnly, signed cookie that the server
 * sets and the browser cannot read or forge. `/api/ticket` and `/api/invoke`
 * take the end user from here and accept no such field from the caller.
 *
 * ── THIS IS A DEMO IDENTITY, NOT AUTHENTICATION ──────────────────────────────
 *
 * Anyone can call `/api/session` and claim a name — there is no password, no
 * provider, no verification. That is deliberate for an example, and it is the
 * ONE thing to replace in a real app: swap `read()` for your own session and
 * everything above it is unchanged, because the rest of this app only ever
 * asks "who is the caller" and never "who do they say they are".
 *
 * What the cookie DOES buy, even as a demo, is that a visitor cannot name a
 * DIFFERENT user than the one they claimed — which is the property a real
 * deployment needs and the one a query parameter would not have.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { ConfigError } from "./failure";

const COOKIE = "elan_demo_user";

/** An end-user id may not contain a colon: `eu:<id>` is how a ticket's subject
 *  is composed, and `agentkit_core.auth.end_user_of` splits on the first one. */
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function secret(): string {
  const found = process.env.DEMO_SESSION_SECRET;
  if (!found) {
    throw new ConfigError(
      "DEMO_SESSION_SECRET is not set. Any long random string will do — " +
        "`openssl rand -hex 32`. It signs the demo identity cookie.",
    );
  }
  return found;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/**
 * Compare in constant time, and survive a length mismatch.
 *
 * `timingSafeEqual` THROWS on buffers of different lengths rather than
 * returning false, so a forged cookie of the wrong length would be a 500
 * instead of a rejection.
 */
function matches(signature: string, expected: string): boolean {
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface Identity {
  /** The end-user id the platform knows: a wallet and a ticket are keyed on it. */
  userId: string;
  /** What to show in the UI. Not used for anything that authorises. */
  label: string;
}

/** The caller's identity, or null when they have not claimed one yet. */
export async function read(): Promise<Identity | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;

  const cut = raw.lastIndexOf(".");
  if (cut <= 0) return null;
  const body = raw.slice(0, cut);
  if (!matches(raw.slice(cut + 1), sign(body))) return null;

  const [userId, encoded] = body.split("|");
  if (!userId || !ALLOWED.test(userId)) return null;
  return {
    userId,
    label: encoded ? Buffer.from(encoded, "base64url").toString("utf8") : userId,
  };
}

/** The `Set-Cookie` value for a freshly claimed identity. */
export function cookieFor(label: string): {
  name: string;
  value: string;
  options: Record<string, unknown>;
} {
  // A STABLE ID THAT IS NOT THE LABEL. Two visitors may both call themselves
  // "Ada"; their runs, and their wallets, must not merge.
  const userId = `demo-${randomBytes(8).toString("hex")}`;
  const body = `${userId}|${Buffer.from(label, "utf8").toString("base64url")}`;
  return {
    name: COOKIE,
    value: `${body}.${sign(body)}`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      // Secure over https only, so `next dev` on http://localhost still works.
      // A `Secure` cookie is STORED over http and never SENT, which is a
      // silent failure: you sign in, and every request afterwards is anonymous.
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export { COOKIE as IDENTITY_COOKIE };
