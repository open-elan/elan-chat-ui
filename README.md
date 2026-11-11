# elan chat example

A chat UI for one elan agent, built with Next.js and
[`elan-sdk`](https://www.npmjs.com/package/elan-sdk). Send the agent a message,
watch its reply arrive live, and answer it when it stops to ask. Alongside the
transcript it shows the agent's card, the end user's credits and statement, and
what that person has let the agent do on its own.

**The browser watches with a ticket; the server acts with a secret.** The
browser only ever holds a short-lived ticket that can watch a run. Everything
that acts — starting a run, approving a tool call, reading history, signing a
file — goes through this app's server, which holds the credentials.

→ **[How it works](docs/how-it-works.md)** explains everything that happens
behind the page.

---

## Quick start

### You need

- **Node.js 22.18 or later** and **pnpm**
- An **elan project** with a deployed **agent** to chat with
- A **service user** in that project that is a **tenant admin**, because
  minting the browser's ticket is an admin capability. Create one in the
  console's API access page.

### 1. Clone and install

```bash
git clone https://github.com/open-elan/elan-chat-ui.git
cd elan-chat-ui
pnpm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What to put |
|---|---|
| `ELAN_API_URL` | `https://api.openelan.ai` |
| `ELAN_PROJECT` | Your project's slug. Don't leave it empty. |
| `ELAN_CLIENT_ID` / `ELAN_CLIENT_SECRET` | The service user's credentials |
| `ELAN_TARGET` | The slug of the agent to chat with |
| `DEMO_SESSION_SECRET` | Any long random string: `openssl rand -hex 32` |
| `DEMO_USER_ID` | Optional. Set it to a wallet's id to have that wallet pay for runs. |

`.env.local` is gitignored, and none of these values is sent to the browser.

### 3. Run

```bash
pnpm dev
```

Open <http://localhost:3002>.

### 4. Try it

1. **Pick a name.** This is a demo sign-in with no password. Replace it with
   your own auth in a real app.
2. **Wait for the composer** to change from "connecting…" to
   "Message *agent*…". That means the live connection is open.
3. **Send a message.** The reply streams in, along with which tools the agent
   used.
4. If the agent asks for **approval** or **input**, a card appears in the
   transcript. Answer it there.

To check your changes, run `pnpm typecheck` and `pnpm build`.

---

## If something is off

| What you see | Likely cause |
|---|---|
| A "Not configured" page | `ELAN_API_URL` is missing from `.env.local`. |
| An error naming a variable that "is not set" | That variable is missing from `.env.local`. Restart `pnpm dev` after editing it. |
| A bare `502` on every request | `ELAN_PROJECT` is empty or wrong, so the app is talking to a project that isn't yours. |
| The composer stays on "connecting…", with a `socket: …` line | The ticket could not be minted. The service user must be a **tenant admin**. Also check the client id and secret. |
| Attaching a file fails with a network error | The agent's `elan.yaml` must list this app's origin under `artifacts.origins`. See [Attachments](docs/how-it-works.md#attachments). |
| Runs work but no wallet is charged | Wallets are keyed on the end-user id, so set `DEMO_USER_ID` to your wallet's id. See [Credits and statement](docs/how-it-works.md#credits-and-statement). |
| An old conversation opens empty | It was started under a different end-user id. The list is kept in the browser and outlives a change of `DEMO_USER_ID`. |
| The agent never asks for approval | A tool has to request confirmation itself. Its tier alone does not make it ask. See [Permissions](docs/how-it-works.md#permissions-what-the-agent-may-do-on-its-own). |
| "Always approve" didn't take effect | A grant takes up to ~30 seconds to apply, and it can't go past the tool's ceiling. |

---

## Learn more

**[docs/how-it-works.md](docs/how-it-works.md)** covers:

- [Who holds what](docs/how-it-works.md#who-holds-what): the ticket/secret split, every route, and what a visitor cannot do
- [What happens when you send a message](docs/how-it-works.md#what-happens-when-you-send-a-message), step by step
- [Identity](docs/how-it-works.md#identity), and how to replace the demo sign-in with your own
- [Conversations, history and liveness](docs/how-it-works.md#conversations-history-and-liveness)
- [Pauses and approvals](docs/how-it-works.md#pauses-and-approvals): the three kinds and how each is answered
- [Attachments](docs/how-it-works.md#attachments): upload, download and retention
- [Permissions](docs/how-it-works.md#permissions-what-the-agent-may-do-on-its-own): tiers, ceilings and standing grants
- [Credits and statement](docs/how-it-works.md#credits-and-statement)
- [Errors and status codes](docs/how-it-works.md#errors-and-status-codes)
- [The traps it is built around](docs/how-it-works.md#the-traps-it-is-built-around)
- [Code map](docs/how-it-works.md#code-map), and the order to read the code in
