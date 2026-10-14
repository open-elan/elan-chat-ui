"use client";

/**
 * Claim a demo identity. THE ONE COMPONENT TO THROW AWAY IN A REAL APP.
 *
 * There is no password here. What it buys even so is the property the rest of
 * the app depends on: after this, the end user's id lives in an httpOnly
 * cookie the server signed, so the browser cannot later name a DIFFERENT user
 * and mint a ticket for their conversations.
 */

import { useState } from "react";

export function SignIn({ agent }: { agent: string }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  return (
    <form
      className="card"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        if (!label.trim() || busy) return;
        setBusy(true);
        setFailed("");
        void fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: label.trim() }),
        })
          .then(async (answer) => {
            if (!answer.ok) {
              const body = (await answer.json().catch(() => ({}))) as { error?: string };
              throw new Error(body.error || "could not start a session");
            }
            // A full reload, so the SERVER re-reads the cookie and renders the
            // chat. The identity is deliberately not available to the client
            // except as what the server chooses to pass down.
            window.location.reload();
          })
          .catch((thrown: unknown) => {
            setFailed(thrown instanceof Error ? thrown.message : String(thrown));
            setBusy(false);
          });
      }}
    >
      <h1>Chat with {agent}</h1>
      <p>
        Pick a name. This is a <strong>demo identity</strong> — no password, no
        verification — and it is the one thing to replace with your own sign-in.
        Everything else works unchanged, because every route asks the server who
        the caller is rather than trusting the browser.
      </p>
      <div className="row">
        <input
          value={label}
          onChange={(changed) => setLabel(changed.target.value)}
          placeholder="Ada"
          maxLength={40}
          disabled={busy}
          aria-label="Your name"
        />
        <button type="submit" disabled={busy || !label.trim()}>
          {busy ? "starting…" : "Start"}
        </button>
      </div>
      {failed && <p className="failed">{failed}</p>}
    </form>
  );
}
