/**
 * Hand back a file somebody attached. The browser fetches the bytes itself.
 *
 * ── WHY THIS IS A REDIRECT AND NOT A DOWNLOAD ────────────────────────────────
 *
 * The mirror of `/api/upload`: this server holds the CREDENTIAL and the browser
 * wants the BYTES, so this route authorises one read and sends the browser to
 * storage for it. Streaming the file through here would put every megabyte of
 * every re-download through this app for no benefit.
 *
 * ── THE LINK IS RESOLVED WHEN IT IS CLICKED, WHICH IS THE WHOLE POINT ────────
 *
 * A signed GET URL lives about five minutes. A transcript lives as long as the
 * conversation, so a signed URL rendered INTO a message would be dead by the
 * time anybody scrolled back to it — and dead in the least helpful way, as an
 * expired-signature error from Google about a request the reader never made.
 *
 * So the message carries a link to THIS route, which is stable, and the signing
 * happens per click. That is also why the redirect must not be cached: a cached
 * 302 would pin one short-lived URL into the browser and break the link a few
 * minutes later. `no-store` says so explicitly rather than relying on 302's
 * default.
 *
 * ── NO CORS IS INVOLVED HERE, UNLIKE THE UPLOAD ──────────────────────────────
 *
 * This is a NAVIGATION to storage, not a cross-origin `fetch`, so the bucket's
 * `artifacts.origins` list is irrelevant to it. Only the PUT needs that. Worth
 * saying because the upload's failure mode is so distinctive that it gets
 * blamed for anything file-shaped.
 */

import { NextResponse } from "next/server";

import { elan, target } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

export async function GET(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams;
  const filename = (query.get("filename") ?? "").trim();
  const sessionId = (query.get("session") ?? "").trim();

  if (!filename) {
    return NextResponse.json({ error: "no filename" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 400 });
  }
  // THE SAME REFUSAL AS THE UPLOAD, AND FOR A SHARPER REASON HERE. `project:`
  // and `agent:` address the organisation's own standing documents, and the
  // credential this route holds is project-scoped — so without this a signed-in
  // visitor could ask for any shared document by guessing its name, and get it.
  // Reading those is a thing the AGENT does, not a thing a visitor's link does.
  if (/^(project|agent|user):/.test(filename)) {
    return NextResponse.json(
      { error: "that name is reserved for the organisation's own documents" },
      { status: 400 },
    );
  }
  if (filename.includes("/") || filename.startsWith(".")) {
    return NextResponse.json(
      { error: "a file name cannot contain a slash or start with a dot" },
      { status: 400 },
    );
  }

  try {
    // THE END USER COMES FROM THE COOKIE, never from the query. This is what
    // confines the read to the asker's OWN prefix: one visitor cannot fetch
    // another's attachment by knowing its name and session.
    const url = await elan().artifacts.downloadUrl(target(), {
      sessionId,
      filename,
      user: who.userId,
      // SAVED UNDER ITS REAL NAME. Without this the browser is handed a blob
      // whose last path segment is a version number, so `scan.png` arrives
      // called `0`.
      attachment: true,
    });
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // A FILE THAT IS GONE IS THE ORDINARY CASE, not a fault. Retention is set
    // per project — `artifacts.retentionDays` in the agent's elan.yaml — so an
    // old conversation's attachments are expected to have been deleted, and the
    // link in that transcript outlives them.
    return failed("that file could not be fetched — it may have been deleted", error);
  }
}
