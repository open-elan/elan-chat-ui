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
| `DEMO_USER_ID` | **Optional, and the one you want if you have opened a wallet.** See below. |

The service user needs to be allowed to mint tickets, which is a **tenant
admin** capability — `POST /v1/tickets` refuses a plain member.

### If you want a wallet to pay for the runs

A wallet is keyed on the **external user id**, so the `demo-<random hex>` id the
sign-in generates can never match one you created: the lookup resolves nothing,
falls back to the tenant's token balance, and charges no wallet at all. Nothing
errors, which is what makes it worth saying.

So if you have run `elan wallet new demo-wallet`, set `DEMO_USER_ID=demo-wallet`
and every run in this app is funded by that wallet. The page footer shows which
id is in play, so you can check at a glance.

It is a **server** variable and not a request field, so a visitor still cannot
point the app at somebody else's wallet.

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
5. **[`components/Chat.tsx`](components/Chat.tsx)** — `useAgentEvents`, the
   composer that waits for the socket, and why the transcript is folded from
   events rather than kept in a local list.
6. **[`components/Approvals.tsx`](components/Approvals.tsx)** — the three kinds
   of pause and the different call each one needs.
7. **[`app/api/history/route.ts`](app/api/history/route.ts)** — the durable
   read, and the ownership check that has to happen before it.
8. **[`lib/sessions.ts`](lib/sessions.ts)** — why the conversation list is
   **yours** and not the platform's.
9. **[`lib/tools.ts`](lib/tools.ts)** — pairing a tool's call with its result,
   and why the fold has no React in it.

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

## Conversations, liveness, and markdown

**The sidebar is the app's own list, because the platform has none to give.** A
session id is yours to choose — nothing mints one — and no route enumerates
them. `GET /v1/sessions` reads the *platform's* database, so for a tenant's
agents it correctly and permanently reports nothing; `GET /v1/runs` lists runs
rather than conversations, has no user filter, and pages 25 rows across every
end user in the project. So [`lib/sessions.ts`](lib/sessions.ts) keeps the list
in `localStorage`, and in a real app **that file is your database**.

**What each conversation SAID comes back from the record**, through
[`/api/history`](app/api/history/route.ts) — because nothing buffers a stream
for a socket that was not open, so without it every chat but the active one
would render empty.

> **`GET /v1/runs` is newer than some deployments.** It arrived with the SDK, so
> a platform whose image predates that answers `404` for it and history cannot
> be read back. The route reports that **once**, in words that name the fix, and
> the chat carries on live — rather than showing an empty transcript and letting
> somebody conclude their conversation was lost. A deployment with no
> observability service answers `501` and is reported the same way.

Two things about that route are the point:

- **It checks ownership before it reads anything.** A session id is a guessable
  string and the service user can see every run in the project, so every run in
  the page must be attributed to `eu:<this caller>` or the whole request is a
  404. Scoped by *session* for a reason: filtering a project-wide page by user
  afterwards would answer "no history" for a busy project, because the caller's
  own runs can be pushed off the first page entirely.
- **`toReply(run)` folds a recorded run into the stream's own shape**, filling
  the identity back in from the run. That is what lets history and live events
  share one renderer instead of two that disagree.

**The transcript is folded from events, not kept in a local list.** The engine
publishes the message that started a run on the `started` event, so the human's
turn is in the stream alongside the agent's. The one thing kept locally is an
optimistic echo of what was just sent: `queued` arrives at once but carries no
text, and `started` cannot arrive until a pod exists.

**`typing` events drive the liveness line.** The platform's typing plugin emits
`{state, subject, label}` where `label` is a ready-made sentence — "Agent is
thinking…", "Agent is searching unpaid invoices…" — so a client does not invent
phrasing and a translation has somewhere to live. It deliberately emits no
`idle` after the model returns, because `content`, `finished` and `error`
already mean clear; the fold walks events in order for exactly that reason, so
the indicator clears when the agent speaks and returns when it goes quiet.

**A settled turn shows what the agent did.** `tool_call` and `tool_result`
events carry ADK's own `function_call` / `function_response` parts, so
[`lib/tools.ts`](lib/tools.ts) pairs them **on the call id and never on
position** — one turn can raise several calls, they can return out of order, and
a confirmed tool's result arrives on the far side of a pause. Collapsed into
"Used search_invoices, fetch_pdf" with a `<details>`, because the answer is the
point and the arguments are the evidence. A call with no result yet reads
"still outstanding" rather than as a failure: a long-running tool is answered by
a system, possibly days later.

Verified against realistic events: results delivered out of order still land on
the right call, an unanswered call is reported as outstanding, a result whose
call is in another segment still appears, and another invocation's calls do not
leak into the turn.

**Replies render as markdown**, because a model writes it whether or not you
render it: shown as plain text, a good answer arrives as `**Total:** £420` with
literal `1.` list markers. **Raw HTML inside a reply is not rendered** —
`react-markdown` without `rehype-raw` — and that default is the reason to use it
rather than `dangerouslySetInnerHTML`: a reply is untrusted text, since it can
repeat anything a user typed or a tool fetched. Verified: an
`<img src=x onerror=…>` in a reply comes out as escaped characters, not an
element. If you ever add `rehype-raw`, add a sanitiser with it.

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
