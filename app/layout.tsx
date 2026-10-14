import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "elan chat example",
  description:
    "The browser watches with a ticket; the server acts with a secret.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
