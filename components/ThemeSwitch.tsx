"use client";

/**
 * System, light or dark — three buttons rather than one that cycles, so the
 * current choice is visible without clicking through to find it.
 */

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { theme, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: LucideIcon }[] = [
  { value: "system", label: "Match system", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeSwitch() {
  // ON THE SERVER, AND FOR THE FIRST CLIENT RENDER, this is "system": the
  // saved choice is in `localStorage`. React re-renders with the real one
  // straight after hydration. The PAGE is already the right colour by then —
  // the inline script in the layout saw to that — so only which button looks
  // pressed can change, and only for that first frame.
  const chosen = useSyncExternalStore(
    theme.subscribe,
    theme.snapshot,
    theme.serverSnapshot,
  );

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={chosen === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => theme.choose(option.value)}
        >
          <option.Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
