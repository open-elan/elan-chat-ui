import type { Metadata } from "next";

import "./globals.css";
import { THEME_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: "elan chat example",
  description:
    "The browser watches with a ticket; the server acts with a secret.",
};

/**
 * THE THEME IS `data-theme`, AS IT IS IN THE CONSOLE — tokens.css restates its
 * dark values under `:root[data-theme="dark"]` and nowhere else.
 *
 * INLINE AND IN THE HEAD, so the saved choice is applied before the first
 * paint: set from an effect instead, a dark-mode reader would see one frame of
 * paper first. It also keeps following the system while the choice is
 * "system" — re-reading the key on every change, so a later pick of light or
 * dark (made by `lib/theme.ts`, which shares this key) is never overridden.
 */
const applySavedTheme = `(() => {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    let saved = null;
    try { saved = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch {}
    const dark = saved === "dark" || (saved !== "light" && query.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  apply();
  query.addEventListener("change", apply);
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` because the script above sets `data-theme`
    // before React hydrates, and the server cannot know what it will be.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applySavedTheme }} />
        {/* GOOGLE SANS, the console's face. Without it the tokens fall back
            to Google Sans Flex and then the system sans. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
