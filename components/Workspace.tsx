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

import { Chat } from "./Chat";
import { Sessions } from "./Sessions";
import { Wallet } from "./Wallet";
import { conversations } from "@/lib/sessions";

export function Workspace({
  agent,
  who,
}: {
  agent: string;
  who: { label: string; userId: string };
}) {
  const [active, setActive] = useState("");

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
    <div className="workspace">
      <aside className="rail">
        <Sessions active={active} onPick={setActive} onNew={open} />
        {/* BETWEEN THE LIST AND THE IDENTITY, because it is about the person
            rather than the conversation — and it reads the balance for the end
            user named just below it. */}
        {active && <Wallet sessionId={active} />}
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
        <Chat key={active} agent={agent} sessionId={active} />
      ) : (
        <div className="chat">
          <div className="transcript">
            <p className="empty">Opening…</p>
          </div>
        </div>
      )}
    </div>
  );
}
