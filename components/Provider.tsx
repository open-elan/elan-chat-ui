"use client";

/**
 * The browser's half: one socket, authenticated by a ticket.
 *
 * ── WHAT CROSSES FROM THE SERVER, AND WHAT CANNOT ────────────────────────────
 *
 * `baseUrl` arrives as a PROP from the server component. It is not a secret —
 * it is the public API's address — and passing it explicitly is why this app
 * needs no `NEXT_PUBLIC_` variable: the one value the browser needs is handed
 * over deliberately, and the credentials are never passed at all, so there is
 * no edit to this file that could leak them.
 *
 * ── THE TICKET SUPPLIER MUST BE A STABLE REFERENCE ───────────────────────────
 *
 * `ElanProvider` opens its socket in an effect keyed on the supplier, so a
 * fresh arrow function each render would tear the socket down and rebuild it on
 * every render — dropping whatever arrived in the gap, which on a warm agent is
 * the reply. `useCallback` with no dependencies is doing real work here.
 */

import { useCallback, type ReactNode } from "react";
import { ElanProvider } from "elan-sdk/react";

export function Provider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children: ReactNode;
}) {
  const ticket = useCallback(async () => {
    // ASKED AGAIN ON EVERY CONNECT, never cached here. A ticket lives about
    // five minutes; a reconnect replaying a stale one is closed 1008, which
    // looks like a broken credential rather than an expired one.
    const answer = await fetch("/api/ticket", { method: "POST" });
    if (!answer.ok) {
      const body = (await answer.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `could not mint a ticket (${answer.status})`);
    }
    const { ticket } = (await answer.json()) as { ticket: string };
    return ticket;
  }, []);

  return (
    <ElanProvider baseUrl={baseUrl} ticket={ticket}>
      {children}
    </ElanProvider>
  );
}
