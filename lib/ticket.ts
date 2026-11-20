/**
 * A fresh ticket for the signed-in end user, from this app's own server.
 *
 * TWO READERS, ONE FETCH. The socket asks for one on every connect, and a
 * connected-account sign-in asks for one when the person clicks Connect: the
 * platform starts that sign-in only with the ticket of the user it was made
 * for, so a link that leaks connects nobody's account to anybody else's run.
 *
 * NEVER CACHED. A ticket lives about five minutes; replaying a stale one is
 * refused, which reads as a broken credential rather than an expired one.
 */
export async function freshTicket(): Promise<string> {
  const answer = await fetch("/api/ticket", { method: "POST" });
  if (!answer.ok) {
    const body = (await answer.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `could not mint a ticket (${answer.status})`);
  }
  const { ticket } = (await answer.json()) as { ticket: string };
  return ticket;
}
