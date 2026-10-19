"use client";

/**
 * Action settings: what this agent may do, and what you have let it do alone.
 *
 * ── THE CEILING IS WHY THIS PAGE NEEDS THE DECLARATION ───────────────────────
 *
 * Built on stored grants alone, this would show somebody their own "act alone"
 * beside a tool that keeps asking them — because a stored policy is clamped to
 * the tool's declared ceiling, and a caller's own ceiling is stripped on the
 * way in so the author's is re-imposed on every call. The row says so instead.
 *
 * ── ABSENT IS NOT A DEFAULT ──────────────────────────────────────────────────
 *
 * A scope with no stored policy has NO OPINION; the store is copy-on-write and
 * a row exists only because somebody chose something. So an untouched tool
 * reads "as the agent ships" rather than showing a tier nobody picked — and
 * revoking returns it to that, rather than writing a default in its place.
 */

import { useCallback, useEffect, useState } from "react";

import { PERMISSIONS_CHANGED } from "@/lib/changed";

import {
  refusalText,
  resolvePermissions,
  type Declared,
  type Outcome,
  type Resolved,
  type StoredPolicy,
} from "@/lib/permissions";

interface Answer {
  slug: string;
  display_name: string;
  version: string;
  default_tier: string;
  acting_tools: string[] | null;
  declared: Record<string, Declared> | null;
  mine: StoredPolicy[];
  tenant: StoredPolicy[];
}

/** Keyed on `Outcome` rather than `string`, so a lookup is total and the
 *  compiler refuses a fourth outcome nobody wrote a sentence for. */
const SAYS: Record<Outcome, string> = {
  allow: "Acts without asking",
  ask: "Asks you first",
  refuse: "Refused",
};

function Row({ row, onRevoke, busy }: {
  row: Resolved;
  onRevoke: (policyId: string) => void;
  busy: boolean;
}) {
  return (
    <li className="perm">
      <div className="perm-head">
        <code className="perm-tool">{row.tool}</code>
        <span className={`perm-outcome perm-${row.outcome}`}>{SAYS[row.outcome]}</span>
      </div>

      <p className="perm-why">
        {row.source === "agent" && "As the agent ships — you have not changed this."}
        {row.source === "you" && "You granted this."}
        {row.source === "tenant" && "Set for your whole organisation."}
      </p>

      {/* THE STATE THIS PAGE EXISTS FOR. A grant that was held down is not a
          mistake and not a failure; it is the author's ceiling doing its job,
          and without a sentence it looks like the grant did not save. */}
      {row.capped && (
        <p className="perm-capped">
          Your setting is capped at <strong>{SAYS[row.outcome].toLowerCase()}</strong> by
          the agent itself. Changing that is a deploy, not a setting.
        </p>
      )}

      {row.refuses.length > 0 && (
        <p className="perm-refuses">
          Always refused when{" "}
          {row.refuses.map((when, at) => (
            <span key={at}>
              {at > 0 && ", or "}
              <code>{refusalText(when)}</code>
            </span>
          ))}
          . No permission can lift this.
        </p>
      )}

      {row.negotiable_rules > 0 && (
        <p className="perm-note">
          The agent declares {row.negotiable_rules} further condition
          {row.negotiable_rules === 1 ? "" : "s"} on this tool.
        </p>
      )}

      {row.labels.length > 0 && (
        <p className="perm-labels">
          {row.labels.map((label) => (
            <span key={label} className="perm-label">{label}</span>
          ))}
        </p>
      )}

      {row.mine && (
        <button
          type="button"
          className="perm-revoke"
          disabled={busy}
          onClick={() => onRevoke(row.mine!.policy_id)}
        >
          {busy ? "Revoking…" : "Revoke, and use the agent's default"}
        </button>
      )}
    </li>
  );
}

export function Permissions() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/permissions");
      const body = (await response.json()) as Answer & { error?: string };
      if (!response.ok) {
        setFailure(body.error || `could not read permissions (${response.status})`);
        return;
      }
      setFailure("");
      setAnswer(body);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A GRANT CAN BE MADE FROM THE APPROVAL CARD, which is not in this subtree.
  useEffect(() => {
    const again = () => void load();
    window.addEventListener(PERMISSIONS_CHANGED, again);
    return () => window.removeEventListener(PERMISSIONS_CHANGED, again);
  }, [load]);

  const revoke = useCallback(
    async (policyId: string) => {
      setBusy(policyId);
      try {
        const response = await fetch("/api/permissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ policyId }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          setFailure(body.error || `could not revoke (${response.status})`);
          return;
        }
        await load();
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  if (failure) return <p className="perm-note">{failure}</p>;
  if (!answer) return null;

  // NOT RECORDED IS NOT "DECLARES NOTHING". A target deployed before these
  // were kept has no declaration, and reporting that as "this agent acts on
  // nothing" is a wrong answer where none is available.
  if (answer.declared === null) {
    return (
      <details className="perms">
        <summary>Action settings</summary>
        <p className="perm-note">
          {answer.acting_tools === null
            ? "This agent was deployed before its declarations were recorded. Redeploy it to see them here."
            : "This agent declares no tools that act, so there is nothing to permit."}
        </p>
      </details>
    );
  }

  const rows = resolvePermissions(
    answer.declared,
    answer.mine,
    answer.tenant,
    answer.default_tier || "t1",
  );

  return (
    <details className="perms">
      <summary>
        Action settings
        <span className="perm-count"> · {rows.length}</span>
      </summary>
      <p className="perm-intro">
        What <strong>{answer.display_name}</strong> may do on your behalf. Tools
        that only read are not listed: they were never gated.
      </p>
      <ul className="perm-list">
        {rows.map((row) => (
          <Row
            key={row.tool}
            row={row}
            busy={busy === row.mine?.policy_id}
            onRevoke={(id) => void revoke(id)}
          />
        ))}
      </ul>
    </details>
  );
}
