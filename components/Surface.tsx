"use client";

/**
 * A view an agent showed — an MCP App: its server's own HTML document, hosted
 * in a sandboxed frame by `McpApp`.
 *
 * The platform reads the view when the tool that declares it is called, and
 * sends it on the event stream as a `surface` event beside the call's
 * arguments and result. Nothing here fetches anything.
 *
 * NO CHOICES ARE DRAWN HERE. A decision has to be auditable, so it is never
 * recorded by markup a server supplied — the pause card owns the controls that
 * answer a run.
 */

import type { AgentEvent } from "elan-sdk";

import { McpApp } from "./McpApp";

export function Surface({ event }: { event: AgentEvent }) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const described = (payload["surface"] ?? {}) as Record<string, unknown>;
  const title = String(described["title"] ?? "App view");
  const html = typeof payload["html"] === "string" ? payload["html"] : "";

  if (!html) {
    const body = typeof described["body"] === "string" ? described["body"] : "";
    return (
      <div className="app-view app-plain" role="group" aria-label={title}>
        <strong>{title}</strong>
        {body && <p>{body}</p>}
      </div>
    );
  }
  return (
    <div className="app-view">
      <McpApp
        html={html}
        csp={typeof payload["csp"] === "string" ? payload["csp"] : ""}
        title={title}
        toolInput={(payload["tool_input"] ?? undefined) as Record<string, unknown> | undefined}
        toolResult={payload["tool_result"]}
      />
    </div>
  );
}
