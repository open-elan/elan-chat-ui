/**
 * What the agent actually did, folded out of the event stream.
 *
 * ── THE PAYLOAD IS ADK'S OWN EVENT, DUMPED WHOLE ─────────────────────────────
 *
 * The engine classifies a `tool_call` by finding a `function_call` part on the
 * content, and a `tool_result` by finding a `function_response` — so that is
 * where the detail is, not in a flat field:
 *
 *   tool_call    payload.content.parts[*].function_call      {id, name, args}
 *   tool_result  payload.content.parts[*].function_response  {id, name, response}
 *
 * PAIRED ON THE CALL ID AND NOT ON POSITION. One model turn can raise several
 * calls, they can return out of order, and a confirmed tool's result arrives on
 * the far side of a pause — which is the same reason the platform's own
 * analytics pair them by id rather than by adjacency.
 *
 * ── FRAMEWORK-FREE, AND IN `lib/` FOR THAT REASON ───────────────────────────
 *
 * This is a fold over events with no React in it, so it does not belong in a
 * `"use client"` module: that would make it uncallable from a server route and
 * untestable without a renderer. The SDK keeps `EventLog` apart from its hooks
 * on the same reasoning — the part that can be got wrong should be reachable
 * without the part that needs a DOM.
 */

import type { AgentEvent } from "elan-sdk";

export interface ToolUse {
  callId: string;
  name: string;
  args: unknown;
  /** undefined while the call is still outstanding. */
  result?: unknown;
}

function parts(event: AgentEvent): Record<string, unknown>[] {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const content = (payload["content"] ?? {}) as Record<string, unknown>;
  const list = content["parts"];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/** Every tool this run used, in the order it called them. */
export function toolsIn(
  events: readonly AgentEvent[],
  invocationId: string,
): ToolUse[] {
  const order: string[] = [];
  const byCall = new Map<string, ToolUse>();

  for (const event of events) {
    if (event.invocation_id !== invocationId) continue;

    if (event.kind === "tool_call") {
      for (const part of parts(event)) {
        const call = part["function_call"] as Record<string, unknown> | undefined;
        if (!call) continue;
        // A CALL WITHOUT AN ID STILL HAPPENED, so it is keyed on its name
        // rather than dropped — ADK supplies one in practice, and a reader
        // seeing nothing would conclude no tool ran.
        const callId = String(call["id"] ?? `unkeyed:${String(call["name"] ?? "")}`);
        if (!byCall.has(callId)) order.push(callId);
        byCall.set(callId, {
          callId,
          name: String(call["name"] ?? "a tool"),
          args: call["args"],
        });
      }
    }

    if (event.kind === "tool_result") {
      for (const part of parts(event)) {
        const answer = part["function_response"] as Record<string, unknown> | undefined;
        if (!answer) continue;
        const callId = String(
          answer["id"] ?? `unkeyed:${String(answer["name"] ?? "")}`,
        );
        const held = byCall.get(callId);
        if (held) {
          byCall.set(callId, { ...held, result: answer["response"] });
        } else {
          // A result with no call in view. Happens when the call is in a
          // segment this reader does not have — a confirmed tool resumes under
          // the SAME invocation id with the pre-pause half elsewhere.
          order.push(callId);
          byCall.set(callId, {
            callId,
            name: String(answer["name"] ?? "a tool"),
            args: undefined,
            result: answer["response"],
          });
        }
      }
    }
  }

  return order.map((id) => byCall.get(id)!);
}

/** Cap what is shown, because a tool can return a document. */
export function preview(value: unknown): string {
  if (value === undefined) return "—";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    // A cycle, or a BigInt. Neither is worth failing a render over.
    text = String(value);
  }
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… truncated` : text;
}

