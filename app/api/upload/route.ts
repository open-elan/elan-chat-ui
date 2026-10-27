/**
 * Authorise one file upload. The browser sends the bytes itself.
 *
 * ── WHY THIS ROUTE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * The browser holds the FILE and this server holds the CREDENTIAL, so neither
 * can do the job alone. This route is the smallest possible join: it asks the
 * platform to authorise one transfer and hands back the URL to PUT to. The
 * bytes never pass through here.
 *
 * A BROWSER CANNOT DO THIS ITSELF. A ticket opens the event stream and nothing
 * else, so it cannot ask the platform to authorise an upload — and that is the
 * right shape rather than a limitation to work around. This route is where a
 * per-user quota, an allow-list of types or a virus scan belongs, and having
 * it means those are a change to this file and not to the platform.
 *
 * ── THE SIZE IS THE AUTHORISATION, NOT A HINT ────────────────────────────────
 *
 * The signed URL pins the exact byte length and content type. A PUT of a
 * different length is refused by storage — so the browser must measure the file
 * before asking, and cannot declare a guess and stream whatever arrives.
 *
 * ── AND THE BUCKET HAS TO ALLOW THIS ORIGIN ──────────────────────────────────
 *
 * The browser PUTs cross-origin to Google, so the bucket's CORS policy must
 * name this app's origin. That is declared in the AGENT's project — in its
 * elan.yaml, under `artifacts.origins` — not here. Miss it and the PUT fails as
 * an indistinguishable network error with nothing in any log, which is why the
 * client-side helper says so by name rather than rethrowing it.
 */

import { NextResponse } from "next/server";

import { elan, target } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

/** 8 MiB. The platform's own ceiling is 512 MiB; this is a product decision.
 *
 *  SMALLER THAN THE PLATFORM'S ON PURPOSE. A chat attachment somebody expects
 *  the agent to read in one turn is a document, not a disk image, and a limit
 *  the product sets is a limit the product can explain. */
const MAX_BYTES = 8 * 1024 * 1024;

/** What an agent can actually be expected to read.
 *
 *  AN ALLOW-LIST, NOT A DENY-LIST. The question is "can the agent do anything
 *  useful with this", and the answer is knowable for a short list and not for
 *  its complement. */
const ALLOWED = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let filename = "";
  let contentType = "";
  let size = 0;
  let sessionId = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.filename === "string") filename = body.filename.trim();
    if (typeof body.contentType === "string") contentType = body.contentType.trim();
    if (typeof body.size === "number") size = body.size;
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
  } catch {
    // Falls through to the checks below, which name the missing field.
  }

  if (!filename) {
    return NextResponse.json({ error: "no filename" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "no sessionId" }, { status: 400 });
  }
  // NAMED IN THE READER'S TERMS. The platform refuses a bad name too, but its
  // message is about a blob path the person never chose.
  if (filename.includes("/") || filename.startsWith(".")) {
    return NextResponse.json(
      { error: "a file name cannot contain a slash or start with a dot" },
      { status: 400 },
    );
  }
  // A SCOPE PREFIX IS NOT A FILE NAME. `project:` and `agent:` address the
  // tenant's own standing documents and are an admin's to write; a visitor's
  // attachment is theirs and belongs to this conversation.
  if (/^(project|agent|user):/.test(filename)) {
    return NextResponse.json(
      { error: "that name is reserved for the organisation's own documents" },
      { status: 400 },
    );
  }
  if (size <= 0) {
    return NextResponse.json({ error: "the file is empty" }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `${filename} is too large — the limit is ${
          MAX_BYTES / (1024 * 1024)
        } MB`,
      },
      { status: 400 },
    );
  }
  if (!ALLOWED.has(contentType)) {
    return NextResponse.json(
      { error: `${contentType || "that kind of file"} cannot be read by the agent` },
      { status: 400 },
    );
  }

  try {
    // THE END USER COMES FROM THE COOKIE, never from the body — the same rule
    // as `/api/ticket`. Passing it is what files the artifact under THEIR
    // prefix, so one visitor's attachment is not visible to another.
    const authorised = await elan().artifacts.declareUpload(target(), {
      sessionId,
      filename,
      contentType,
      size,
      user: who.userId,
    });
    // THE SIGNED URL AND ITS HEADERS, PASSED THROUGH UNTOUCHED. Every header is
    // part of what was signed; adding or dropping one breaks the signature and
    // storage then complains about the signature rather than the header.
    return NextResponse.json({
      url: authorised.url,
      method: authorised.method,
      headers: authorised.headers,
      filename: authorised.filename,
      version: authorised.version,
      expires_at: authorised.expiresAt,
    });
  } catch (error) {
    return failed("could not authorise the upload", error);
  }
}
