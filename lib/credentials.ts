/**
 * The person's own keys and tokens, which every message carries to the agent.
 *
 * ── THEIR OWN, BROUGHT BY THEM ───────────────────────────────────────────────
 *
 * A credential here is one the person typed in themselves — a maps key, a
 * token for a notes service — for an agent whose tools name it (ADR-0249). The
 * browser sends it to this app's own `/api/invoke`, which hands it to the
 * platform as the invocation's SECURITY CONTEXT. That is the only way in: a
 * ticket cannot start a run, so the browser could not send one to the platform
 * if it wanted to. The platform then attaches each credential ONLY to the MCP
 * binding whose `ToolAuth` names it, and only within `resource` when set.
 *
 * ── KEPT IN THIS TAB AND NOWHERE ELSE ────────────────────────────────────────
 *
 * React state, not `localStorage`: a key written to storage outlives the tab,
 * is readable by every script on the origin, and is still there for the next
 * person at a shared computer. So a reload forgets them, and that is the point.
 * The platform holds each one sealed for the run's `ttl_seconds` and deletes it
 * when the run ends; it never reaches the conversation, an event or the model.
 *
 * ── SHARED BY BOTH HALVES ────────────────────────────────────────────────────
 *
 * The dialog checks a credential with `problemWith` before it is added, naming
 * the field the person can see; the route re-checks the SHAPE with `parse`,
 * because a request body is anybody's. The platform still decides — these only
 * make its refusal arrive before the key leaves the page.
 */

import type { SecurityContext } from "elan-sdk";

/** One credential, as the dialog collects it. */
export interface Credential {
  name: string;
  kind: "bearer" | "api_key";
  value: string;
  /** For an API key: the header it is sent in. Empty means `X-API-Key`. */
  header: string;
  /** The one URL it may be sent to. Empty means any binding that names it. */
  resource: string;
}

export const BLANK: Credential = { name: "", kind: "bearer", value: "", header: "", resource: "" };

/** The platform's limit on one security context. */
export const MAX_CREDENTIALS = 16;

// THE PLATFORM'S OWN RULES, repeated so a refusal names the field on screen
// (`elan_agentkit_contracts.security_context` is where they are decided).
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME_MAX = 32;
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DENIED_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authorization", "proxy-connection",
  "te", "trailer", "transfer-encoding", "upgrade", "accept",
]);
const DENIED_HEADER_PREFIXES = ["content-", "mcp-", "x-agentkit-"];

/** What is wrong with a credential, worded against the dialog's fields. */
export function problemWith(credential: Credential, taken: string[]): string {
  if (!NAME.test(credential.name) || credential.name.length > NAME_MAX) {
    return "Name must be lower-case letters, digits and single hyphens, such as maps.";
  }
  if (taken.includes(credential.name)) {
    return `You already added ${credential.name}. Edit that one, or choose another name.`;
  }
  if (!credential.value) {
    return credential.kind === "api_key" ? "Enter the key." : "Enter the token.";
  }
  if (credential.kind === "api_key" && credential.header) {
    const lowered = credential.header.toLowerCase();
    if (!HEADER.test(credential.header)) {
      return "Header must be a header name, such as X-Goog-Api-Key, with no spaces or colons.";
    }
    if (DENIED_HEADERS.has(lowered) || DENIED_HEADER_PREFIXES.some((p) => lowered.startsWith(p))) {
      return `Header cannot be ${credential.header}: it shapes the request rather than authorizing it.`;
    }
  }
  if (credential.resource) {
    let url: URL;
    try {
      url = new URL(credential.resource);
    } catch {
      return "Only for this URL must be a full address, such as https://maps.example.com/mcp.";
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return "Only for this URL must use https, so the key is never sent in clear text.";
    }
  }
  return "";
}

/** How a credential is sent, in one line: the kind, its header, where it may go. */
export function describe(credential: Credential): string {
  const how = credential.kind === "api_key"
    ? `API key in ${credential.header || "X-API-Key"}`
    : "Bearer token";
  return credential.resource ? `${how} · only to ${credential.resource}` : how;
}

/**
 * A request body's `credentials`, or a sentence saying why not. SHAPE ONLY:
 * every rule about names, headers and URLs is the platform's, and a refusal
 * from it comes back through `failed` like any other.
 */
export function parse(raw: unknown): Credential[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "credentials must be a list";
  if (raw.length > MAX_CREDENTIALS) return `at most ${MAX_CREDENTIALS} credentials`;
  const out: Credential[] = [];
  for (const item of raw) {
    const held = (item ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof held[key] === "string" ? (held[key] as string) : "");
    const kind = held.kind === "api_key" ? "api_key" : held.kind === "bearer" ? "bearer" : null;
    if (!kind || !text("name") || !text("value")) {
      return "each credential needs a name, a kind (bearer or api_key) and a value";
    }
    out.push({ name: text("name"), kind, value: text("value"),
               header: text("header"), resource: text("resource") });
  }
  return out;
}

/** The credentials as the platform takes them. */
export function securityContextOf(credentials: Credential[]): SecurityContext {
  return {
    credentials: credentials.map((credential) => {
      const bound = credential.resource ? { resource: credential.resource } : {};
      return credential.kind === "api_key"
        ? { kind: "api_key" as const, name: credential.name, key: credential.value,
            ...(credential.header ? { header: credential.header } : {}), ...bound }
        : { kind: "bearer" as const, name: credential.name, token: credential.value, ...bound };
    }),
  };
}
