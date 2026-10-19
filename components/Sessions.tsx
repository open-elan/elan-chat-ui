"use client";

/**
 * The conversations this app knows about.
 *
 * The list is the app's own — see `lib/sessions.ts` for why the platform has
 * none to give. What each one SAID comes back from `/api/history`, because
 * nothing buffers a stream for a socket that was not open.
 */

import { useSyncExternalStore } from "react";
import { Plus, X } from "lucide-react";

import { conversations, type Conversation } from "@/lib/sessions";

// THE SERVER SNAPSHOT IS EMPTY, and it has to be: this list lives in
// `localStorage`, which the server cannot read. Returning the client's value
// would be a hydration mismatch. It is ONE array, made once — React compares
// snapshots by identity, and a fresh `[]` per call reads as a change every
// time, which is the infinite loop it warns about.
const NONE: readonly Conversation[] = [];
const serverSnapshot = () => NONE;

export function Sessions({
  active,
  onPick,
  onNew,
}: {
  active: string;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const all = useSyncExternalStore(
    conversations.subscribe,
    conversations.snapshot,
    serverSnapshot,
  );

  return (
    <div className="rail-body">
      <button type="button" className="new" onClick={onNew}>
        <Plus size={16} aria-hidden="true" />
        New chat
      </button>

      {all.length === 0 && <p className="rail-empty">No conversations yet.</p>}

      <ul className="rail-list">
        {all.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === active ? "rail-item on" : "rail-item"}
              onClick={() => onPick(item.id)}
            >
              <span className="rail-title">{item.title || "Untitled"}</span>
              <span className="rail-id">{item.id}</span>
            </button>
            <button
              type="button"
              className="rail-drop"
              // NOT A DELETE, and the title says so. The runs stay in the
              // platform's record; nothing in this app has the authority to
              // erase somebody's history, and pretending otherwise in an
              // example would teach the wrong thing.
              title="Remove from this list. The conversation itself is not deleted."
              aria-label={`Remove ${item.title || item.id} from this list`}
              onClick={() => conversations.forget(item.id)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
