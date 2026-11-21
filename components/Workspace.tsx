"use client";

/**
 * The sidebar and the conversation, and which one is active.
 *
 * A CLIENT COMPONENT BECAUSE THE LIST IS IN `localStorage`, which the server
 * cannot read — see `lib/sessions.ts` for why the platform has no list to give.
 * The provider above it holds ONE socket for the whole tree; switching
 * conversations changes the argument to `useAgentEvents`, and the stream
 * reference-counts its per-session handlers, so the old subscription is dropped
 * and the new one added without the socket being touched.
 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Chat } from "./Chat";
import { Sessions } from "./Sessions";
import { AgentCard } from "./AgentCard";
import { Connections } from "./Connections";
import { Credentials } from "./Credentials";
import { Permissions } from "./Permissions";
import { Wallet } from "./Wallet";
import type { Credential } from "@/lib/credentials";
import { conversations } from "@/lib/sessions";

export function Workspace({
  agent,
  who,
}: {
  agent: string;
  who: { label: string; userId: string };
}) {
  const [active, setActive] = useState("");
  // HELD HERE, ABOVE THE CHAT, because the chat remounts per conversation and
  // a key the person added is theirs for every conversation in this tab.
  // Memory only — see `lib/credentials.ts`.
  const [credentials, setCredentials] = useState<Credential[]>([]);
  // THE RIGHT-HAND PANEL, OPEN BY DEFAULT at every width. On a narrow screen
  // it slides over the conversation rather than squeezing it, and its own
  // close button is right there.
  const [details, setDetails] = useState(true);

  // ON THE CLIENT ONLY, and after mount: reading `localStorage` during render
  // would be a hydration mismatch, since the server rendered an empty list.
  useEffect(() => {
    const all = conversations.snapshot();
    setActive(all[0]?.id ?? conversations.open());
  }, []);

  const open = useCallback(() => {
    setActive(conversations.open());
  }, []);

  return (
    <div className={details ? "workspace with-details" : "workspace"}>
      {/* LEFT: WHICH CONVERSATION, AND WHO. Everything about the person's
          account and the agent moved to the panel on the right, so the rail
          is the list and nothing competes with it. */}
      <aside className="rail">
        <Sessions active={active} onPick={setActive} onNew={open} />
        <div className="whoami">
          {/* `Array.from` so a name starting with an emoji or an accented
              letter yields one character rather than half a surrogate pair. */}
          <span className="avatar" aria-hidden="true">
            {Array.from(who.label)[0]?.toUpperCase()}
          </span>
          <p className="whoami-text">
            <span className="whoami-label">Watching as</span>
            <strong>{who.label}</strong>
            <span className="whoami-id">{who.userId}</span>
          </p>
        </div>
      </aside>
      {/* KEYED ON THE SESSION, so switching conversations remounts the chat
          rather than leaving the previous one's pending echoes and scroll
          position in place. */}
      {active ? (
        <Chat
          key={active}
          agent={agent}
          sessionId={active}
          credentials={credentials}
          details={details}
          onDetails={() => setDetails((shown) => !shown)}
        />
      ) : (
        <div className="chat">
          <div className="transcript">
            <p className="empty">Opening…</p>
          </div>
        </div>
      )}
      {/* RIGHT: THE PERSON AND THE AGENT — what they can spend, what the
          agent is and may do, the accounts and keys it uses for them. The
          same sections the rail used to hold, in the same order, drawn from
          the rail's palette so the two sides read as one frame. */}
      {/* HIDDEN, NOT UNMOUNTED: unmounted, every section re-read its data
          and folded itself shut each time the panel came back. */}
      <aside className="details" aria-label="Details" hidden={!details}>
        <div className="details-head">
          <span>Details</span>
          <button
            type="button"
            className="details-close"
            aria-label="Hide details"
            title="Hide details"
            onClick={() => setDetails(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="details-body">
          {/* It reads the balance for the end user named at the foot of the
              rail. */}
          {active && <Wallet sessionId={active} />}
          <AgentCard />
          <Permissions />
          {/* The accounts they have let the agent use, and the way to sign
              the agent out of one. */}
          <Connections />
          {/* The other half of the same question: those are accounts the
              platform signs in to for them; these are keys they bring. */}
          <Credentials value={credentials} onChange={setCredentials} />
        </div>
      </aside>
    </div>
  );
}
