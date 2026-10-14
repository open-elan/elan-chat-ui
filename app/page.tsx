/**
 * A SERVER COMPONENT, which is what makes the credential split work.
 *
 * It reads the identity cookie and the API's address on the server, then hands
 * the browser exactly one of those two things. The client components below it
 * receive `baseUrl` and the agent's name as props; they are never given, and
 * cannot ask for, the service user's id or secret.
 */

import { Chat } from "@/components/Chat";
import { Provider } from "@/components/Provider";
import { SignIn } from "@/components/SignIn";
import { read } from "@/lib/identity";

export default async function Page() {
  const who = await read();

  // Read here rather than in the client, so no `NEXT_PUBLIC_` variable exists
  // and the only value that crosses is this one, deliberately.
  const baseUrl = process.env.ELAN_API_URL ?? "";
  const agent = process.env.ELAN_TARGET ?? "the agent";

  if (!baseUrl) {
    return (
      <main className="shell">
        <div className="card">
          <h1>Not configured</h1>
          <p>
            Copy <code>.env.example</code> to <code>.env.local</code> and fill
            it in. <code>ELAN_API_URL</code> is missing.
          </p>
        </div>
      </main>
    );
  }

  if (!who) {
    return (
      <main className="shell">
        <SignIn agent={agent} />
      </main>
    );
  }

  return (
    <main className="shell">
      <Provider baseUrl={baseUrl}>
        <Chat agent={agent} />
      </Provider>
      <p className="whoami">
        watching as <strong>{who.label}</strong>{" "}
        <span className="dim">({who.userId})</span>
      </p>
    </main>
  );
}
