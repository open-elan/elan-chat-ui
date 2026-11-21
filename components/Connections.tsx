"use client";

/**
 * Connected accounts: the third parties this person has signed in to, and the
 * way to sign out of one (ADR-0260).
 *
 * ── SIGNING OUT IS DELETING THE TOKENS ON THE PLATFORM ───────────────────────
 *
 * The platform keeps them, so Disconnect is the whole of "log out of the MCP
 * server": the next run that needs the account pauses and asks again. It does
 * not revoke this app at the provider — that is the person's, from the
 * provider's own settings — and the panel says so rather than implying more.
 *
 * ── IT REFRESHES WHEN THIS WINDOW GETS FOCUS BACK ────────────────────────────
 *
 * A sign-in happens in a small window the platform closes once it is done, and
 * focus returns here as it closes. So a new connection appears without a
 * reload, and nothing polls while the person is simply reading.
 */

import { KeyRound, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionView } from "elan-sdk";
import { SECTION } from "@/lib/panel";

/** "20 Nov, 20:58" — short enough for the rail. */
function day(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function Connections() {
  const [rows, setRows] = useState<ConnectionView[] | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      const body = (await response.json()) as {
        connections?: ConnectionView[];
        error?: string;
      };
      if (!response.ok) {
        setFailure(body.error || `could not list connected accounts (${response.status})`);
        return;
      }
      setFailure("");
      setRows(body.connections ?? []);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [load]);

  const disconnect = useCallback(
    async (name: string) => {
      setBusy(name);
      try {
        const response = await fetch("/api/connections", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setFailure(body.error || `could not disconnect ${name} (${response.status})`);
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
  if (rows === null) return null;

  return (
    <details className="perms" name={SECTION}>
      <summary>Connected accounts</summary>
      {rows.length === 0 ? (
        <p className="perm-note">
          None yet. When the agent needs one of your accounts it asks you to
          connect it, once.
        </p>
      ) : (
        <ul className="accounts">
          {rows.map((row) => (
            // A LIST TILE: what it is on the left, the way to sign out of it
            // on the right, where the eye ends a row.
            <li key={row.name} className="account">
              <span className="account-icon" aria-hidden="true">
                <KeyRound size={14} />
              </span>
              <div className="account-main">
                <span className="account-name">{row.name}</span>
                <span className={`account-status ${row.status === "connected" ? "perm-allow" : "perm-capped"}`}>
                  {row.status === "connected" ? "Connected" : "Needs signing in again"}
                </span>
              </div>
              <button
                type="button"
                className="account-disconnect"
                aria-label={`Disconnect ${row.name}`}
                disabled={busy === row.name}
                onClick={() => void disconnect(row.name)}
              >
                <Unplug size={13} aria-hidden="true" />
                {busy === row.name ? "…" : "Disconnect"}
              </button>
              {/* ITS OWN ROW, under the name and the button: the rail is
                  narrow, and squeezed between them this wrapped to three
                  lines. */}
              <span className="account-meta">
                Since {day(row.connected_at)}
                {row.last_used_at ? ` · last used ${day(row.last_used_at)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="perm-note">
        Disconnecting signs the agent out here; the next time it needs the
        account it asks you again. To revoke this app entirely, remove it in
        the provider&apos;s own settings.
      </p>
    </details>
  );
}
