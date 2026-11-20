"use client";

/**
 * What the agent did with its tools, AS IT HAPPENS.
 *
 * LIVE WHILE THE TURN RUNS, FOLDED ONCE IT ENDS. Each call appears the moment
 * its `tool_call` event arrives — a spinner while it runs, a check when its
 * result does — because a run that spends ten seconds searching and shows
 * nothing for ten seconds reads as broken. Once the answer is in, the answer
 * is the point and the tools are the evidence, so the list folds into one
 * `<details>` line that opens on a click.
 *
 * AN OUTSTANDING CALL IS NOT A FAILURE. A long-running tool is answered by a
 * system, possibly days later, and a pending confirmation is waiting on a
 * person — so a paused turn's outstanding call shows a clock, not a spinner.
 *
 * The fold lives in `lib/tools.ts`, which has no React in it.
 */

import { Check, ChevronRight, CircleAlert, Clock, LoaderCircle } from "lucide-react";

import { preview, type ToolUse } from "@/lib/tools";

/** `search_pull_requests` -> "Search pull requests". */
function humanise(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** A result that says it failed: MCP's `isError`, or an `error` the tool set. */
function failed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const held = result as Record<string, unknown>;
  return held["isError"] === true || (typeof held["error"] === "string" && held["error"] !== "");
}

type StepState = "running" | "waiting" | "done" | "failed";

function stateOf(tool: ToolUse, paused: boolean): StepState {
  if (tool.result === undefined) return paused ? "waiting" : "running";
  return failed(tool.result) ? "failed" : "done";
}

function StepIcon({ state }: { state: StepState }) {
  return (
    <span className="step-icon" data-state={state}>
      {state === "running" && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
      {state === "waiting" && <Clock size={14} aria-hidden="true" />}
      {state === "done" && <Check size={14} aria-hidden="true" />}
      {state === "failed" && <CircleAlert size={14} aria-hidden="true" />}
    </span>
  );
}

function Steps({ used, paused }: { used: ToolUse[]; paused: boolean }) {
  return (
    <ol className="steps">
      {used.map((tool) => {
        const state = stateOf(tool, paused);
        return (
          <li key={tool.callId}>
            <details className="step">
              <summary>
                <StepIcon state={state} />
                <span className="step-name">{humanise(tool.name)}</span>
                <code className="step-code">{tool.name}</code>
                <span className="visually-hidden">, {state}</span>
              </summary>
              <div className="tools-pair">
                <span className="tools-label">sent</span>
                <pre>{preview(tool.args)}</pre>
              </div>
              <div className="tools-pair">
                <span className="tools-label">returned</span>
                <pre>{tool.result === undefined ? "still outstanding" : preview(tool.result)}</pre>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export function Tools({ used, live, paused = false }: {
  used: ToolUse[];
  /** The turn is still running: every call shown, not a folded line. */
  live: boolean;
  paused?: boolean;
}) {
  if (used.length === 0) return null;

  if (live) {
    return (
      <div className="activity" aria-live="polite">
        <Steps used={used} paused={paused} />
      </div>
    );
  }

  const names = [...new Set(used.map((tool) => humanise(tool.name)))];
  const outstanding = used.filter((tool) => tool.result === undefined).length;

  return (
    <details className="tools-used">
      <summary>
        <ChevronRight className="tools-caret" size={14} aria-hidden="true" />
        <span className="tools-verb">Used</span> {names.join(", ")}
        {outstanding > 0 && <span className="tools-pending"> · {outstanding} still outstanding</span>}
      </summary>
      <div className="activity">
        <Steps used={used} paused={paused} />
      </div>
    </details>
  );
}
