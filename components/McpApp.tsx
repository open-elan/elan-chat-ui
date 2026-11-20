"use client";

/**
 * Host for an MCP App — a server-supplied HTML view, under sandbox.
 *
 * PORTED FROM THE PLATFORM CONSOLE'S PLAYGROUND (`components/playground/McpApp.tsx`), where it is the
 * platform's own MCP Apps host. The security posture is the point:
 *
 *   - `sandbox="allow-scripts"` and NEVER `allow-same-origin`. Together they
 *     give the frame this app's own origin, from which it could read the
 *     page's storage and remove its own sandbox. Without the second the
 *     frame's origin is opaque, which is what makes `srcDoc` safe at all.
 *   - Every inbound message is checked against this frame's `contentWindow`:
 *     `message` fires for any frame on the page and for browser extensions.
 *   - The CSP the server declared is injected into the document rather than
 *     trusted to be there.
 *   - Links are opened by the HOST after a scheme check, never by the view.
 *
 * `tools/call` FROM THE VIEW IS NOT OFFERED (`toolsCall: false`). An agent's MCP
 * servers are reached by its runtime, not by a browser.
 *
 * A VIEW CANNOT BE MEASURED BY THE HOST. It is opaque-origin, so its height
 * arrives only as `ui/notifications/size-changed`; one that never sends it
 * renders at the starting height.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_HEIGHT = 120;
const MAX_HEIGHT = 900;

export function McpApp({ html, csp, toolInput, toolResult, onMessage, title = "App view" }: {
  html: string;
  csp: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  /** The view asked to put a turn into the conversation. */
  onMessage?: (text: string) => void;
  title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [ready, setReady] = useState(false);

  const post = useCallback((message: unknown) => {
    // "*" IS CORRECT HERE AND ONLY HERE: the frame's origin is opaque, so no
    // origin string would ever match it. Isolation is the sandbox's.
    frame.current?.contentWindow?.postMessage(message, "*");
  }, []);

  useEffect(() => {
    function heard(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as {
        jsonrpc?: string; id?: string | number; method?: string; params?: unknown;
      } | undefined;
      if (!data || data.jsonrpc !== "2.0" || typeof data.method !== "string") return;
      const params = (data.params ?? {}) as Record<string, unknown>;

      switch (data.method) {
        case "ui/initialize":
          post({
            jsonrpc: "2.0", id: data.id,
            result: { capabilities: {
              message: Boolean(onMessage), openLink: true,
              displayMode: false, toolsCall: false,
            } },
          });
          return;
        case "ui/notifications/initialized":
          setReady(true);
          return;
        case "ui/notifications/size-changed": {
          const next = Number(params["height"]);
          if (Number.isFinite(next) && next > 0) setHeight(Math.min(Math.ceil(next), MAX_HEIGHT));
          return;
        }
        case "ui/open-link": {
          const url = String(params["url"] ?? "");
          if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        case "ui/message": {
          const content = params["content"] as { text?: string } | undefined;
          const text = typeof content?.text === "string" ? content.text : "";
          if (text.trim() && onMessage) onMessage(text);
          return;
        }
        default:
          // A view built against a later spec should degrade, not hang on us.
          return;
      }
    }
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [post, onMessage]);

  // ONLY ONCE THE VIEW SAYS IT IS LISTENING. Sent earlier, the data lands
  // before the frame's script attached its handler and is silently lost.
  useEffect(() => {
    if (!ready) return;
    if (toolInput !== undefined) {
      post({ jsonrpc: "2.0", method: "ui/notifications/tool-input",
             params: { arguments: toolInput } });
    }
    if (toolResult !== undefined) {
      post({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
             params: { structuredContent: toolResult } });
    }
  }, [ready, toolInput, toolResult, post]);

  return (
    <iframe
      ref={frame}
      title={title}
      className="app-frame"
      // A MEASURED HEIGHT, which is why this is inline: it is whatever the
      // view last reported.
      style={{ height }}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={withPolicy(html, csp)}
    />
  );
}

/** The CSP, put into the document itself — a sandboxed `srcDoc` frame has no
 *  response headers to carry one. */
function withPolicy(html: string, csp: string): string {
  if (!csp) return html;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => `${head}\n${meta}`);
  return `${meta}\n${html}`;
}
