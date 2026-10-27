/**
 * Sending an attachment: two steps, and they fail for different reasons.
 *
 * ── WHY THE BYTES DO NOT GO THROUGH THIS APP ─────────────────────────────────
 *
 * `/api/upload` authorises ONE transfer and answers with a URL signed for
 * exactly this file, this length and this type. The browser PUTs to Google
 * directly, so an attachment never passes through this app's server and is not
 * bounded by whatever body limit it happens to have.
 *
 * ── THE SECOND STEP FAILS INVISIBLY, WHICH IS WHY THIS FILE EXISTS ───────────
 *
 * A blocked cross-origin PUT reaches JavaScript as an indistinguishable network
 * error: no status, no body, nothing in any log on either side. The cause is
 * almost always that the bucket's CORS policy does not name this origin — which
 * is declared in the AGENT's project, in its elan.yaml under
 * `artifacts.origins`. Rethrowing a bare `TypeError: Failed to fetch` would
 * send somebody to read their own code, so this says what to go and check.
 *
 * ── AND AN UPLOAD IS NOT A MESSAGE ───────────────────────────────────────────
 *
 * Storing a file tells the agent nothing. The agent learns about it because the
 * MESSAGE NAMES IT, which is what `announce()` below is for — an invocation
 * carries text parts and nothing else, so there is nowhere else for the name to
 * go.
 *
 * The name is enough: the platform loads a file the message names and puts the
 * real bytes in the model request, so a vision model reads the file itself. A
 * tool calling `load_artifact(filename)` is still the way to reach a shared
 * `project:`/`agent:` document, or a file too large to put in a prompt.
 *
 * WHICH MEANS THE NAME MUST MATCH EXACTLY. `receipt.jpg` is found;
 * "the receipt I just sent" is not, and nothing errors when it is not.
 */

export interface Attachment {
  filename: string;
  version: number;
  size: number;
  contentType: string;
}

export class UploadFailed extends Error {}

/** Authorise, then send. Returns what the message should name. */
export async function upload(file: File, sessionId: string): Promise<Attachment> {
  // MEASURED BEFORE IT IS DECLARED. The signed URL pins the exact length, so a
  // guess is refused by storage rather than truncated.
  const authorised = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      sessionId,
    }),
  });

  if (!authorised.ok) {
    // THIS APP'S OWN REFUSALS ARE ALREADY WRITTEN FOR A PERSON — too large,
    // wrong type, reserved name — so they are passed through rather than
    // flattened into "upload failed".
    const body = (await authorised.json().catch(() => ({}))) as { error?: string };
    throw new UploadFailed(body.error || `could not authorise (${authorised.status})`);
  }

  const ticket = (await authorised.json()) as {
    url: string;
    method: string;
    headers: Record<string, string>;
    filename: string;
    version: number;
  };

  let stored: Response;
  try {
    // EXACTLY THE HEADERS WE WERE GIVEN, and no Authorization: that URL is
    // Google's host, and a credential of ours there would be a credential sent
    // to a third party in a request that succeeds.
    stored = await fetch(ticket.url, {
      method: ticket.method,
      headers: ticket.headers,
      body: file,
    });
  } catch (cause) {
    throw new UploadFailed(
      "the file could not reach storage. In a browser this is almost always " +
        "CORS: the bucket has to allow this page's origin for PUT, which is " +
        "declared in the agent's elan.yaml under `artifacts.origins`. A " +
        "blocked preflight arrives here as a plain network error with nothing " +
        "in any log.",
      { cause },
    );
  }

  if (!stored.ok) {
    throw new UploadFailed(
      `storage refused the file (${stored.status}). The signed URL pins the ` +
        `exact size and type that were declared, so a file that changed ` +
        `between choosing and sending is refused.`,
    );
  }

  return {
    filename: ticket.filename,
    version: ticket.version,
    size: file.size,
    contentType: file.type || "application/octet-stream",
  };
}

/** How an attachment is announced to the agent.
 *
 *  IN THE TEXT, BECAUSE THERE IS NOWHERE ELSE. An invocation carries text parts
 *  and nothing else — a file field on the envelope would be rejected by every
 *  already-deployed agent image, which is why the platform does not have one.
 *  So the name travels in the sentence and the agent reads it back by name. */
export function announce(text: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return text;
  const names = attachments.map((a) => a.filename).join(", ");
  const noun = attachments.length === 1 ? "file" : "files";
  return text
    ? `${text}\n\n(attached ${noun}: ${names})`
    : `Please look at the attached ${noun}: ${names}`;
}
