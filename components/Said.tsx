/**
 * The visitor's own message, with any attachment it names as a link.
 *
 * ── NOT MARKDOWN, DELIBERATELY ───────────────────────────────────────────────
 *
 * The agent's side goes through `Markdown` because a model writes markdown
 * whether or not you render it. A person typing in a chat box does not, and
 * rendering their text as markdown would eat their asterisks and turn a line
 * starting `# ` into a heading. So this is plain text — `.mine` keeps
 * `white-space: pre-wrap` for exactly that reason — with one exception made
 * for the filenames the composer itself appended.
 *
 * ── WHY THE LINK IS BUILT FROM THE TEXT ──────────────────────────────────────
 *
 * `attachedIn` reads the sentence `announce()` wrote. That looks indirect when
 * the alternative seems to be "just keep the attachment list", and the
 * alternative does not survive a reload: a transcript fetched from the server
 * is text and nothing else. Parsing is what makes a link work for a message
 * sent last week rather than only for one sent in this tab.
 *
 * ── AN ATTACHMENT MAY BE GONE, AND THAT IS NORMAL ────────────────────────────
 *
 * Retention is per project (`artifacts.retentionDays`), so an old
 * conversation's files are expected to expire while its transcript remains.
 * The link stays rendered and `/api/download` explains it on click — which is
 * better than hiding it, because a missing link reads as "this was never
 * attached" rather than "this is no longer kept".
 */

"use client";

import { Paperclip } from "lucide-react";
import type { ReactNode } from "react";

import { attachedIn, downloadHref } from "@/lib/upload";

export function Said({
  text,
  sessionId,
}: {
  text: string;
  sessionId: string;
}) {
  const names = attachedIn(text);
  if (names.length === 0 || !sessionId) {
    return <p className="mine">{text}</p>;
  }

  // SPLIT ON THE NAMES THEMSELVES, so the sentence around them is preserved
  // exactly as it was sent — including the parentheses and the leading blank
  // line, which are part of what the agent was told.
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (const name of names) {
    const at = rest.indexOf(name);
    if (at === -1) continue;
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(
      <a
        key={`${name}:${key++}`}
        className="attachment"
        href={downloadHref(name, sessionId)}
        // A NEW TAB, because this navigates away to storage and losing the
        // conversation to a download is a poor trade.
        target="_blank"
        rel="noreferrer"
        title={`Download ${name}`}
      >
        <Paperclip size={13} aria-hidden="true" />
        {name}
      </a>,
    );
    rest = rest.slice(at + name.length);
  }
  if (rest) parts.push(rest);

  return <p className="mine">{parts}</p>;
}
