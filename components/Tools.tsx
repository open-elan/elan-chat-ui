"use client";

/**
 * The tool list, collapsed.
 *
 * A `<details>` RATHER THAN STATE: collapsed by default because a tool's
 * arguments are routinely noisier than the answer, and open-on-click with no
 * JavaScript and correct keyboard and screen-reader behaviour for free.
 *
 * The fold lives in `lib/tools.ts`, which has no React in it.
 */

import { preview, type ToolUse } from "@/lib/tools";

export function Tools({ used }: { used: ToolUse[] }) {
  if (used.length === 0) return null;

  const names = [...new Set(used.map((tool) => tool.name))];
  const outstanding = used.filter((tool) => tool.result === undefined).length;

  return (
    <details className="tools-used">
      <summary>
        <span className="tools-verb">Used</span> {names.join(", ")}
        {outstanding > 0 && (
          // AN OUTSTANDING CALL IS NOT A FAILURE. A long-running tool is
          // answered by a system, possibly days later, and a pending
          // confirmation is waiting on a person.
          <span className="tools-pending">
            {" "}
            · {outstanding} still outstanding
          </span>
        )}
      </summary>

      <ol className="tools-detail">
        {used.map((tool) => (
          <li key={tool.callId}>
            <code className="tools-name">{tool.name}</code>
            <div className="tools-pair">
              <span className="tools-label">sent</span>
              <pre>{preview(tool.args)}</pre>
            </div>
            <div className="tools-pair">
              <span className="tools-label">returned</span>
              <pre>
                {tool.result === undefined ? "still outstanding" : preview(tool.result)}
              </pre>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
