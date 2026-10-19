/**
 * Light, dark, or whatever the system says.
 *
 * NO `"use client"`, ON PURPOSE. The server layout imports `THEME_KEY` for its
 * inline script, and a constant imported from a client module arrives on the
 * server as a client REFERENCE, not as the string. Nothing here touches the
 * browser until it is called, and only client components call it.
 *
 * THE THEME ITSELF IS `data-theme` ON `<html>`, as it is in the console:
 * tokens.css restates its dark values under `:root[data-theme="dark"]` and
 * nowhere else. This file only decides which value that attribute holds.
 *
 * ── TWO PLACES APPLY IT, AND THEY MUST AGREE ─────────────────────────────────
 *
 * The inline script in `app/layout.tsx` applies the saved choice before the
 * first paint, and keeps following the system while the choice is "system".
 * This store applies a NEW choice when somebody picks one. Both read the same
 * key with the same meaning; change one and change the other.
 *
 * ── THE SHAPE IS `useSyncExternalStore`'s ────────────────────────────────────
 *
 * As `lib/sessions.ts` is. The snapshot is a string, so it is stable by value
 * and needs no caching.
 */

export const THEME_KEY = "elan-chat-theme";

export type ThemeChoice = "system" | "light" | "dark";

const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return CHOICES.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : "system";
  } catch {
    // Storage can be blocked outright (a private window, a strict policy).
    // The page still themes; the choice just does not survive a reload.
    return "system";
  }
}

let current: ThemeChoice = typeof window === "undefined" ? "system" : read();

function apply(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export const theme = {
  snapshot: (): ThemeChoice => current,

  /** What the server renders: it cannot read `localStorage`. */
  serverSnapshot: (): ThemeChoice => "system",

  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    // ANOTHER TAB CHANGED IT. `storage` fires only in the tabs that did not
    // write, which is exactly the set that needs telling.
    const fromElsewhere = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      current = read();
      apply(current);
      listener();
    };
    window.addEventListener("storage", fromElsewhere);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", fromElsewhere);
    };
  },

  choose(choice: ThemeChoice): void {
    current = choice;
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      // See `read`: applied for this page, not remembered.
    }
    apply(choice);
    listeners.forEach((listener) => listener());
  },
};
