"use client";

/**
 * The list of conversations. THIS APP'S OWN, BECAUSE THE PLATFORM HAS NO SUCH
 * LIST TO GIVE.
 *
 * ── WHY NOT ASK THE PLATFORM ─────────────────────────────────────────────────
 *
 * A session id is YOURS TO CHOOSE — nothing mints one for you — and no route
 * enumerates them:
 *
 *   - `GET /v1/sessions` reads the PLATFORM's database. ADK writes a
 *     conversation to the AGENT'S OWN database, so for a tenant's agents that
 *     route correctly and permanently reports nothing. It is not a bug and
 *     waiting will not fix it.
 *   - `GET /v1/runs` lists RUNS, not conversations, has no user filter, and
 *     pages 25 rows across every end user in the project — so grouping it into
 *     "my chats" is unreliable the moment the project is busy.
 *
 * So keeping the list is the caller's job. In a real app this file is YOUR
 * DATABASE, keyed by your own user id. `localStorage` is what an example can
 * honestly use, and the shape below is deliberately the one a database-backed
 * version would have too: an id, a title, a timestamp.
 *
 * ── THE SHAPE IS `useSyncExternalStore`'s ────────────────────────────────────
 *
 * `subscribe` plus a referentially stable `snapshot`, exactly as the SDK's own
 * `EventLog` is — React compares snapshots BY IDENTITY and re-renders when they
 * differ, so a snapshot that rebuilt its array on every read would re-render
 * for ever. Hence the cached value and the dirty flag.
 */

const KEY = "elan-chat-sessions";

export interface Conversation {
  id: string;
  /** The first thing said in it. Filled in when the first message is sent. */
  title: string;
  /** Epoch seconds, for ordering. */
  startedAt: number;
}

function load(): Conversation[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Conversation =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Conversation).id === "string",
    );
  } catch {
    // A private window, cleared site data, or a browser set to block it. An
    // empty list is the right answer; throwing here would break the page.
    return [];
  }
}

function save(all: Conversation[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A per-tab list is a fine degradation; it is not worth a failed render.
  }
}

function newId(): string {
  return `chat-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

class Store {
  private all: Conversation[] | null = null;
  private readonly listeners = new Set<() => void>();

  private get held(): Conversation[] {
    if (this.all === null) this.all = load();
    return this.all;
  }

  /** Newest first, and REFERENTIALLY STABLE between changes. */
  snapshot = (): readonly Conversation[] => this.held;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private commit(all: Conversation[]): void {
    this.all = all;
    save(all);
    for (const listener of [...this.listeners]) listener();
  }

  /** Make one and return its id. Untitled until something is said in it. */
  open(): string {
    const made: Conversation = {
      id: newId(),
      title: "",
      startedAt: Math.floor(Date.now() / 1000),
    };
    this.commit([made, ...this.held]);
    return made.id;
  }

  /** Record the first thing said, so the sidebar has something to show. */
  title(id: string, text: string): void {
    const found = this.held.find((item) => item.id === id);
    if (!found || found.title) return; // the FIRST message only
    const title = text.trim().replace(/\s+/g, " ").slice(0, 60);
    this.commit(this.held.map((item) => (item.id === id ? { ...item, title } : item)));
  }

  forget(id: string): void {
    // THE CONVERSATION ITSELF IS NOT DELETED, and the sidebar says so. Its runs
    // stay in the platform's record; this only stops listing it here, because
    // nothing in this app has the authority to erase somebody's history.
    this.commit(this.held.filter((item) => item.id !== id));
  }
}

export const conversations = new Store();
