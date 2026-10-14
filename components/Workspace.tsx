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
import { conversations } from "@/lib/sessions";

export function Workspace({ agent }: { agent: string }) {
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
      <Sessions active={active} onPick={setActive} onNew={open} />
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
