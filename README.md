# elan chat example

A chat UI for one agent: send it a message, watch its reply arrive live, and
answer it when it stops to ask.

**The browser watches with a ticket; the server acts with a secret.** That split
is the whole subject of this example — not the chat, which is twenty lines of
`<p>` tags. If you take one thing from it, take the split.

---

## Why there are two halves

A **ticket** opens `/ws` and nothing else. Every other route answers `403`. So
a browser holding one can *watch* a run and cannot start one, cannot list
approvals, cannot decide one, and cannot read a run back.

Everything that **acts** therefore happens in a route handler, with a service
user's credentials that never leave the server:

```
  browser                        this app's server                 platform
  ───────                        ─────────────────                 ────────
  POST /api/session ───────────► sets a signed httpOnly cookie
                                 (who the end user is)

  POST /api/ticket ────────────► tickets.mint(userId, {origin}) ──► /v1/tickets
  ◄──────────── a ~300s ticket

  opens wss://…/ws ─────────────────────────────────────────────► /ws
  (subscribes to the session)

  POST /api/invoke ────────────► runtime.invoke(agent, text, ────► /v1/invocations
                                   {sessionId, endUserId})          202
  ◄═══════════ the reply arrives on the SOCKET, never in a response ═══════════

  POST /api/approvals ─────────► actions.decideBatch(...) ───────► /v1/actions/…
  POST /api/resume ────────────► runtime.resume(id, {payload}) ──► /v1/invocations/…/resume
```

**`end_user_id` is what makes this work rather than a detail.** Naming an end
user on an invocation addresses that run's events to `eu:<id>` — to *them*, not
to whoever published it. A backend that invokes for its customer and then waits
on its own socket waits out its whole timeout and reports silence about a run
that worked perfectly; the SDK raises `EndUserEventsElsewhere` to catch exactly
that. This app is the shape that trap describes as correct: the server invokes
naming the end user, the browser holds a ticket for the **same** end user, and
that is why the reply lands in the page.

Verified rather than asserted: a production build with planted credentials has
none of them anywhere in the client bundle. Next only exposes `NEXT_PUBLIC_*`
variables to the browser and none of these are, so there is no edit to a
component that could leak one — the build would inline `undefined`.

---

## Running it

### Prerequisite: the SDK is not published yet

`elan-sdk` is a `file:` dependency on a sibling checkout, because the package
is not on npm yet. So:

```bash
git clone <the platform repo> ../elan-platform
cd ../elan-platform && make sdk-ts-build    # produces sdk/typescript/dist
cd -
```

When the SDKs publish this becomes one line in `package.json`
(`"elan-sdk": "^0.1.0"`) and the clone goes away.

### Then

```bash
pnpm install
cp .env.example .env.local     # fill it in — see below
pnpm dev                       # http://localhost:3002
```

| Variable | What it is |
|---|---|
| `ELAN_API_URL` | The platform's base URL, e.g. `https://api.np.openelan.ai`. |
| `ELAN_PROJECT` | Your project's slug. **Empty means the *platform's* project**, which is not yours, and surfaces as a bare `502`. |
| `ELAN_CLIENT_ID` / `ELAN_CLIENT_SECRET` | A service user, from the console's API access page or `POST /v1/projects/{project}/service-users`. |
| `ELAN_TARGET` | Which agent this chat talks to. |
| `DEMO_SESSION_SECRET` | Signs the demo identity cookie. `openssl rand -hex 32`. |

The service user needs to be allowed to mint tickets, which is a **tenant
admin** capability — `POST /v1/tickets` refuses a plain member.

---

## What to read, in order

1. **[`lib/elan.ts`](lib/elan.ts)** — the only module that holds a secret, and
   why `origin` is read from the request rather than configured.
2. **[`lib/identity.ts`](lib/identity.ts)** — why the end user's id is the
   server's and never the browser's. **The one file to replace** with your own
   auth.
3. **[`app/api/ticket/route.ts`](app/api/ticket/route.ts)** — minting the
   browser's credential, and the field it deliberately does not accept.
4. **[`components/Provider.tsx`](components/Provider.tsx)** — the ticket
   **supplier**, and why it must be a stable reference.
5. **[`components/Chat.tsx`](components/Chat.tsx)** — `useAgentEvents`, and the
   composer that waits for the socket.
6. **[`components/Approvals.tsx`](components/Approvals.tsx)** — the three kinds
   of pause and the different call each one needs.

---

## The traps it is built around

Each of these cost somebody real time before it was written down.

| | |
|---|---|
| **Subscribe before you invoke.** Pub/Sub discards a message published to a topic with no subscription, and rt-service creates the tenant's when its first socket opens — so a client that invokes and *then* connects loses the whole reply on a warm agent. | The composer is disabled until the stream reports `ready`. |
| **A ticket is a supplier, not a string.** It lives about five minutes and the socket reconnects with backoff, so a cached one is refused on the first reconnect — as a `1008` close, which reads like a broken credential. | `ElanProvider` takes `() => Promise<string>`; `/api/ticket` is asked again on every connect. |
| **`origin` is pinned exactly and a suffix does not count.** A ticket minted for `https://example.com` is refused from `https://evil.example.com`. | Minted from the request's own origin, so there is no setting to get wrong. |
| **A reply is at `payload.content.parts[*].text`** and the parts must be **joined** — `payload.text` does not exist on a content event, and reading it finds nothing on every one of them. | `textOf` is imported from the SDK, never reimplemented. |
| **A paused run emits two `paused` events and no `finished` at all.** Only the engine's synthesised one carries `interrupt_kind`, and a `content` event can sit *between* the two — so "the last paused" is not even a positional rule. | `Approvals` discriminates on the payload key. |
| **A turn's answers travel as one batch.** Answer one of two confirmations and the other is silently abandoned while the run reports finished. | `decideBatch` on every action in the batch, and `published` is what says anything ran. |
| **An `abandoned` status can follow an approval** — the engine refuses a batch with a later user turn — and it means nothing ran. | Reported rather than shown as a tick. |
| **A resume carries data, not just consent.** `payload` becomes the paused node's own output and flows to the next node. | The `input` card sends a value. |
| **A resume can be refused for funds where the first turn was not.** A pause settles and holds nothing, so the resumed turn reserves on its own merits. | `/api/resume` maps that to a `402`. |

---

## What it deliberately does not do

**It does not touch `/observability` or `/ledger`.** Those are not publicly
routed, and the one host that did expose them was deleted for that reason. Cost,
traces and balances are the console's job and a different credential's reach.

**It does not use `useRun`**, even though `elan-sdk/react` exports it. A
provider given only a `ticket` installs a placeholder token for the HTTP side —
a ticket is not a credential HTTP may use — so `useRun` would call
`runs.get()` with something that reaches nothing and 401. That hook is for the
console's cookie credential. If you need the durable read ("my socket
dropped"), add a server route that calls `runs.get()` with the service user.

**It has no tests.** The gates are `pnpm typecheck` and `pnpm build`, and the
typecheck is the one that matters: it binds against the SDK's real types, so a
field that moves is a compile error here. That is the entire reason this example
*imports* the wire types instead of mirroring them — the app it replaces
hand-mirrored them, lost three fields, invented a fourth, and every one of those
four mistakes typechecked.

**It is not in the platform's CI.** Nothing stops it drifting from the SDK it
imports; the mitigation is structural rather than procedural, and it is the
paragraph above.

---

## Replacing the demo identity

`/api/session` has no password, no provider and no verification — anyone can
claim a name. Swap `read()` in [`lib/identity.ts`](lib/identity.ts) for your own
session and **nothing else changes**, because every route asks *who is the
caller* rather than trusting what the caller says.

What the cookie buys even as a demo is the property a real deployment needs: a
visitor cannot name a *different* end user than the one they claimed, so they
cannot mint a ticket for somebody else's conversations.
