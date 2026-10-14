"use client";

/**
 * An agent's reply, rendered.
 *
 * ── A MODEL WRITES MARKDOWN WHETHER OR NOT YOU RENDER IT ─────────────────────
 *
 * Shown as plain text, a perfectly good answer arrives as `**Total:** £420` and
 * a numbered list with literal `1.` markers and no line breaks between the
 * items. The content was right and the presentation made it look wrong.
 *
 * ── NO RAW HTML, DELIBERATELY ────────────────────────────────────────────────
 *
 * `react-markdown` does not render embedded HTML unless you add `rehype-raw`,
 * and this does not. That default is the whole reason to use it rather than
 * `dangerouslySetInnerHTML` with a hand-rolled converter: a model's output is
 * untrusted text — it can repeat anything a user typed, or anything a tool
 * fetched off the open internet — so `<img onerror=…>` in a reply must render
 * as characters and not as an element. If you ever reach for `rehype-raw` here,
 * that is the moment to add a sanitiser with it.
 *
 * Links get `rel="noopener noreferrer"` and open in a new tab, for the same
 * reason: the destination is not this app's choice.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        // GFM for tables, strikethrough and task lists — the dialect models
        // actually write, rather than the 2004 original.
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: inner }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {inner}
            </a>
          ),
          // A fenced block gets a scroll container of its own, so a long line
          // cannot widen the whole transcript.
          pre: ({ children: inner }) => <pre className="md-pre">{inner}</pre>,
          table: ({ children: inner }) => (
            <div className="md-scroll">
              <table>{inner}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
