"use client";

/**
 * Your keys: credentials the person brings for the agent's tools, one tile
 * each, added in a dialog. See `lib/credentials.ts` for where they go and why
 * they are never stored.
 *
 * ── A DIALOG, BECAUSE THE RAIL IS NARROW ─────────────────────────────────────
 *
 * Five fields will not fit beside a conversation list, and a form left open
 * there is the first thing on a rail whose job is to show what already
 * exists. So the rail lists what is set and `+ Credential` opens the fields.
 *
 * `<dialog>` WITH `showModal()`, not a div: the browser gives the focus trap,
 * Escape, the top layer and an inert page behind it, which a hand-rolled one
 * gets wrong. Escape closes it WITHOUT telling React, so `close` is listened
 * for — otherwise `editing` stays set and the button can never reopen it.
 *
 * ── A REFUSAL IS INLINE, IN THE DIALOG ───────────────────────────────────────
 *
 * It names the field that is wrong, beside the fields, and stays until the
 * next try — a key that was refused is still on screen and still the thing to
 * fix.
 */

import { KeyRound, Pencil, Plus, Ticket, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  BLANK,
  MAX_CREDENTIALS,
  describe,
  problemWith,
  type Credential,
} from "@/lib/credentials";
import { SECTION } from "@/lib/panel";

export function Credentials({
  value,
  onChange,
}: {
  value: Credential[];
  onChange: (next: Credential[]) => void;
}) {
  // WHICH ONE THE DIALOG IS WRITING: `null` closed, -1 a new one, else an index.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Credential>(BLANK);
  const [refused, setRefused] = useState("");
  const box = useRef<HTMLDialogElement>(null);
  const full = value.length >= MAX_CREDENTIALS;

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    if (editing !== null && !dialog.open) dialog.showModal();
    if (editing === null && dialog.open) dialog.close();
  }, [editing]);

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    const closed = () => {
      setEditing(null);
      setDraft(BLANK);
      setRefused("");
    };
    dialog.addEventListener("close", closed);
    return () => dialog.removeEventListener("close", closed);
  }, []);

  function open(index: number) {
    setDraft(index < 0 ? BLANK : (value[index] ?? BLANK));
    setRefused("");
    setEditing(index);
  }

  function close() {
    setEditing(null);
    // THE TYPED KEY LEAVES WITH THE DIALOG. Kept in the draft after Cancel it
    // would sit in memory belonging to nothing on screen.
    setDraft(BLANK);
    setRefused("");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (editing === null) return;
    const taken = value.filter((_, index) => index !== editing).map((held) => held.name);
    const clean: Credential = {
      ...draft,
      name: draft.name.trim(),
      header: draft.kind === "api_key" ? draft.header.trim() : "",
      resource: draft.resource.trim(),
    };
    const problem = problemWith(clean, taken);
    if (problem) {
      setRefused(problem);
      return;
    }
    onChange(editing < 0
      ? [...value, clean]
      : value.map((held, index) => (index === editing ? clean : held)));
    close();
  }

  const isKey = draft.kind === "api_key";

  return (
    <>
    {/* THE COUNT IS IN THE SUMMARY, so a key riding every message is never
        out of sight even with the section folded. */}
    <details className="perms" name={SECTION}>
      <summary>
        Your keys{value.length > 0 && <span className="perm-count"> · {value.length}</span>}
      </summary>

      {value.length === 0 ? (
        <p className="perm-note">
          None. If the agent uses a service with your own key — a maps key, a
          notes token — add it here.
        </p>
      ) : (
        <ul className="accounts">
          {value.map((credential, index) => (
            <li key={credential.name} className="account">
              <span className="account-icon" aria-hidden="true">
                {credential.kind === "api_key" ? <KeyRound size={14} /> : <Ticket size={14} />}
              </span>
              <div className="account-main">
                <span className="account-name">{credential.name}</span>
              </div>
              <div className="account-actions">
                <button
                  type="button"
                  className="account-edit"
                  aria-label={`Edit ${credential.name}`}
                  title={`Edit ${credential.name}`}
                  onClick={() => open(index)}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="account-disconnect"
                  aria-label={`Remove ${credential.name}`}
                  onClick={() => onChange(value.filter((_, at) => at !== index))}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Remove
                </button>
              </div>
              <span className="account-meta">{describe(credential)}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="credential-add"
        disabled={full}
        title={full ? `At most ${MAX_CREDENTIALS}` : "Add a key or token"}
        onClick={() => open(-1)}
      >
        <Plus size={13} aria-hidden="true" />
        Credential
      </button>
      <p className="perm-note">
        Sent with every message until you remove it. Kept in this tab only: a
        reload forgets it.
      </p>
    </details>

      {/* OUTSIDE THE <details>: a closed one hides its contents, and the
          dialog must open whatever state the section is in. */}
      <dialog
        ref={box}
        className="sheet"
        aria-labelledby="credential-title"
        // CLICKING THE BACKDROP CLOSES IT. The backdrop belongs to the dialog
        // element itself, so a click on it lands on the dialog, not a child.
        onClick={(clicked) => {
          if (clicked.target === box.current) close();
        }}
      >
        <form onSubmit={save} className="sheet-body">
          <div className="sheet-head">
            <h2 id="credential-title">
              {editing !== null && editing >= 0 ? `Edit ${value[editing]?.name ?? "credential"}` : "Add credential"}
            </h2>
            <button type="button" className="sheet-close" aria-label="Close" onClick={close}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {refused && <p className="sheet-refused" role="alert">{refused}</p>}

          <label className="field">
            <span>Name</span>
            <input value={draft.name} placeholder="maps" autoComplete="off"
                   onChange={(e) => setDraft((held) => ({ ...held, name: e.target.value }))} />
            <small>The name the agent asks for.</small>
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={draft.kind}
                    onChange={(e) => setDraft((held) => ({
                      ...held, kind: e.target.value as Credential["kind"] }))}>
              <option value="bearer">Bearer token</option>
              <option value="api_key">API key in a header</option>
            </select>
          </label>
          <label className="field">
            <span>{isKey ? "Key" : "Token"}</span>
            {/* `new-password`, NOT `off`: browsers ignore `off` on a password
                field and fill a saved sign-in into it. */}
            <input type="password" autoComplete="new-password" value={draft.value}
                   placeholder={isKey ? "Paste your key" : "Paste your token"}
                   onChange={(e) => setDraft((held) => ({ ...held, value: e.target.value }))} />
            <small>Kept in this tab only. It is gone when you reload.</small>
          </label>
          {isKey && (
            <label className="field">
              <span>Header</span>
              <input value={draft.header} placeholder="X-API-Key" autoComplete="off"
                     onChange={(e) => setDraft((held) => ({ ...held, header: e.target.value }))} />
              <small>The header the service reads the key from.</small>
            </label>
          )}
          <label className="field">
            <span>Only for this URL (optional)</span>
            <input value={draft.resource} placeholder="https://maps.example.com/mcp" autoComplete="off"
                   onChange={(e) => setDraft((held) => ({ ...held, resource: e.target.value }))} />
            <small>When set, the key is sent to this address and nothing else.</small>
          </label>

          <div className="sheet-actions">
            <button type="button" className="reject" onClick={close}>Cancel</button>
            <button type="submit">
              {editing !== null && editing >= 0 ? "Save" : "Add credential"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
