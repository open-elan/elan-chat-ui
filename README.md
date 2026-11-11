# elan chat example

A chat UI for one agent: send it a message, watch its reply arrive live, and
answer it when it stops to ask. Alongside the transcript it shows the agent's
own card, the end user's credits and statement, and **what that person has let
the agent do on its own** — which is the half most likely to be built wrong,
and has its own section below.

**The browser watches with a ticket; the server acts with a secret.** That split
is the whole subject of this example — not the chat, which is twenty lines of
`<p>` tags. If you take one thing from it, take the split.

---

## Why there are two halves

A **ticket** opens `/ws` and nothing else. Every other route answers `403`. So
a browser holding one can *watch* a run and cannot start one, cannot list
approvals, cannot decide one, cannot read a run back, and cannot store a file.

Everything that **acts** therefore happens in a route handler, with a service
user's credentials that never leave the server — including an attachment, where
the route authorises the transfer and the browser sends the bytes to storage
itself:

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

  POST /api/upload ────────────► artifacts.declareUpload(...) ───► /v1/artifacts/uploads
  ◄──────────── a signed PUT url
  PUT  storage.googleapis.com ──────────────────────────────────► (the bytes, direct)

  POST /api/approvals ─────────► actions.decideBatch(...) ───────► /v1/actions/…
  POST /api/resume ────────────► runtime.resume(id, {payload}) ──► /v1/invocations/…/resume

  GET  /api/agent ─────────────► agents.get(slug) ───────────────► /v1/agents
  GET  /api/permissions ───────► agents.get + autonomy.policies ─► /v1/agents
                                                                   /v1/autonomy/policies
  POST /api/permissions ───────► autonomy.reset(id, {user}) ─────► /v1/autonomy/policies/…/reset
  GET  /api/wallet ────────────► wallets.get + wallets.statement ► /v1/projects/{p}/wallets/…
```

Every one of those server calls refuses a ticket, which is why each is a route
here rather than a `fetch` from a component.

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

`elan-sdk` comes from npm (`"elan-sdk": "^0.1.2"`), so there is nothing to
check out beside this repo.

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

## What is in it

Nothing here is framework-clever. The server routes are the product; the
components are a thin reading of an event stream.

| | |
|---|---|
| `lib/elan.ts` | The one module holding a secret. One client per process, because it caches the token. |
| `lib/identity.ts` | Who the end user is, from a signed httpOnly cookie. **Replace this with your auth.** |
| `lib/failure.ts` | A thrown thing → a status a reader can act on. Not everything is a `502`. |
| `lib/sessions.ts` | The conversation list, in `localStorage`. **In a real app this is your database.** |
| `lib/tools.ts` | Pairs `function_call` with `function_response` on the call id. No React in it. |
| `lib/permissions.ts` | Folds the declaration and the stored grants into one row per tool. No React in it. |
| `lib/changed.ts` | One event name, so the approval card and the settings panel agree. |
| `lib/upload.ts` | Authorise, then PUT. Names the CORS cause, because that one fails with nothing in any log. |
| `app/api/session`, `/ticket` | Sign in; mint the browser's ~300s stream credential. |
| `app/api/invoke`, `/resume` | Start a run; answer a workflow input pause with data. |
| `app/api/approvals` | List what a run is waiting on, and decide a whole batch. |
| `app/api/history` | The durable read, with the ownership check that must precede it. |
| `app/api/agent`, `/permissions` | The agent's card; what it may do and what this person allowed. |
| `app/api/wallet` | Credits and statement. Read-only by construction. |
| `app/api/upload` | Authorises ONE attachment. The bytes never pass through it. |
| `components/Workspace.tsx` | The rail and the transcript. |
| `components/Chat.tsx` | The transcript, folded from events rather than kept in a list. |
| `components/Approvals.tsx` | The three kinds of pause, and the different call each needs. |
| `components/Tools.tsx`, `Markdown.tsx` | What the agent did; rendering a reply safely. |
| `components/AgentCard.tsx`, `Permissions.tsx` | The two rail panels about the agent itself. |

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
10. **[`app/api/permissions/route.ts`](app/api/permissions/route.ts)** — the two
    sources a permissions page needs, and why neither alone is honest.
11. **[`lib/permissions.ts`](lib/permissions.ts)** — the resolution order as far
    as a page can know it, and the one step it deliberately cannot do.
12. **[`lib/failure.ts`](lib/failure.ts)** — why a thrown thing is not always a
    `502`, learned by answering one for a fault in `.env.local`.

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
| **`actions.batches` defaults to `scope: "mine"`,** and a confirmation raised by an END USER's run is recorded against `eu:<id>` — not against the service user that published it. The default therefore finds none of them, and the card renders with no Approve button and no error, which reads as "the agent never asks". | Tenant scope, which this credential already has. |
| **…and tenant scope returns EVERY end user's actions.** The action row carries no `user_id` to filter on, so taking it without a second thought is worse than the bug. | The session's runs are read first, every one checked against `eu:<caller>`, and only actions whose invocation is in that set are shown or decided. |
| **The browser learns of a pause BEFORE the action row exists.** `action_requested` and the terminal `paused` travel the same ordered topic to different consumers — rt-service relays the pause straight down the socket while actions-service has to commit a row — so a single fetch fired on the pause asks for something that is not there yet. | A short retry schedule, stopping on the first hit, and a sentence rather than a silent empty card if it never arrives. |
| **A standing grant is stored unclamped and clamped on read.** "Always approve" on a tool the author capped is written, accepted, and then has no effect. | The button is offered only where the ceiling permits, and a tool it cannot free is named. |
| **A grant takes effect within ~30s, not instantly.** The pod refreshes its policy snapshot once per run on a 30-second TTL. | Worth knowing before you conclude a grant did not save. |
| **The recorded manifest only changes when a target MOVES.** A redeploy with no source change keeps the facts it had — deliberately, since this deploy's manifests describe a build the target is not running. | A new manifest field reaches an agent on its next real deploy, not on the next `elan deploy`. |

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

## Attachments, and the two things that make them do nothing

The paperclip stores a file and names it in the next message. That is all the
UI can do — the two halves that make it *useful* are outside this repo, and
both are easy to miss because neither fails loudly.

**1. The name has to be in the message, and it is.** There is no file field on
an invocation — an invocation carries text, and a new field on that envelope
would be rejected by every already-deployed agent image — so the name travels
in the sentence. `announce()` in `lib/upload.ts` is what puts it there.

That is enough on its own: **the platform loads a file the message names and
puts the real bytes in the model request**, so a vision model reads the scan
rather than a sentence about it. No tool required.

A tool is still the better answer for some cases — a file larger than the
16 MiB-per-request ceiling, a shared `project:` or `agent:` document (those are
deliberately never auto-attached), or anything the agent should read without
the user naming it:

```python
async def read_attachment(filename: str, tool_context: ToolContext) -> dict:
    """Read a file the guest attached to this conversation."""
    part = await tool_context.load_artifact(filename)
    if part is None or part.inline_data is None:
        return {"status": "not_found"}
    return {"text": part.inline_data.data.decode("utf-8", "replace")}
```

**What to expect when it does not work:** the name in the text must match the
stored name exactly — `receipt.jpg`, not "the receipt I just sent".

**2. The bucket has to allow this app's origin.** The browser PUTs
cross-origin to Google, so the agent's project must declare it:

```yaml
# in the AGENT's elan.yaml, not this repo
artifacts:
  origins: ["https://chat.example.com", "http://localhost:3002"]
```

Miss it and the PUT fails as an indistinguishable network error — no status, no
body, nothing in any log on either side. `lib/upload.ts` catches that one case
and says which file to go and edit, because a bare `TypeError: Failed to fetch`
sends you to read your own code.

### What it stores, and where

An attachment is **session-scoped**: it belongs to this conversation and this
end user, and another visitor cannot see it. `/api/upload` refuses a name
beginning `project:` or `agent:` for that reason — those address the
organisation's own standing documents and are an admin's to write from the
console, not a visitor's from a chat box.

The file is on the platform **before** the message is sent, which is why
removing a chip says "don't mention" rather than "delete": the bytes are
already stored, and the chip only controls whether the next message names them.

### Why the size is declared up front

The signed URL pins the exact byte length and content type. A PUT of a
different length is refused by storage — so the browser measures the file
before asking for authorisation and cannot declare a guess and stream whatever
arrives. It also means a file that changes between choosing and sending is
refused rather than silently stored wrong.

---

## Permissions: what the agent may do on its own

The rail carries two panels about the agent itself — **About this agent**
([`AgentCard.tsx`](components/AgentCard.tsx)) and **Action settings**
([`Permissions.tsx`](components/Permissions.tsx)). The second is the
interesting one, and it is the part of this example most likely to be wrong in
a real app.

### A tier does not make a tool ask

This is the thing to take away, and it cost a deploy to find out.

Autonomy resolves to one of three outcomes: `t0` **refuses**, `t1` **asks**,
`t2` **allows**. The natural reading of "the agent's default tier is t1, so it
asks" is wrong. The plugin blocks at `refuse`, pre-confirms at `allow`, and
**does nothing at all in between** — `ask` is the status quo. So a tool that
never requests a confirmation is unaffected by every tier except `t0`, however
it is declared.

A tool that should pause has to ask for itself:

```python
confirmation = tool_context.tool_confirmation
if confirmation is None:
    tool_context.request_confirmation(hint="Log a sighting of 3 clownfish (reef)?")
    tool_context.actions.skip_summarization = True
    return {"status": "awaiting_approval"}
if not confirmation.confirmed:
    return {"status": "declined"}
# ... only here does anything happen
```

**The hint IS the approval card**, which is why a tool asks from its own body
rather than setting `require_confirmation=True`: ADK's default hint is written
for a developer ("…by responding with a FunctionResponse with an expected
ToolConfirmation payload") and is shown to a person verbatim. Asking from the
body also lets the tool validate first, so nothing impossible is ever put up
for approval.

**And the body runs twice** — once to ask, once to act. Anything that changes
state before the confirmation check happens whether or not a person said yes.

### Declare the tools that ACT, and only those

A tool that acts is declared whether or not it ever pauses, because `t0` has to
be able to refuse it. A tool that only reads should be left out, and that is
not laziness — declaring a read buys no pause and costs three things: the
agent card claims the tool acts, at `t2` every single lookup files an
"approved automatically" audit row, and at `t0` the read is refused while an
undeclared one would still be allowed.

### A permissions page needs two sources, and neither alone is honest

| | |
|---|---|
| `GET /v1/agents` | what the AUTHOR declared — tier, **ceiling**, labels, refusals |
| `GET /v1/autonomy/policies` | what the PERSON stored — their grants, and the tenant cap |

Built on stored grants alone the page is worse than none. A stored policy is
clamped to the tool's declared **ceiling**, and a caller's own ceiling is
stripped on the way in so the author's is re-imposed on every call — so the
page would show somebody their own "acts without asking" beside a tool that
keeps asking them, with nothing on screen to account for the difference.

[`lib/permissions.ts`](lib/permissions.ts) folds the two. It reproduces the
resolver's steps 2 and 3 exactly — stricter of the scopes that stored
something, clamped to the ceiling; else the declared tier, else the default —
and deliberately **cannot** do step 1: a declared refusal is a condition on the
arguments of a call that has not happened, so the conditions are listed rather
than evaluated. Only stored policies are clamped; the manifest's own tier is
not, because it is already code.

Absence is the other half. **A scope with no stored policy has NO OPINION**,
never a default one — the store is copy-on-write and a row exists only because
somebody chose something. So an untouched tool reads "as the agent ships", and
revoking returns it to that rather than writing a default in its place.

### "Always approve" is gated on the ceiling

The approval card offers a third button, which records a standing grant for
that tool. Two things about it:

- **It is written against whose card it was**, not against whoever clicked. An
  admin deciding a colleague's card would otherwise grant *themselves*
  autonomy while leaving the colleague asked about every call.
- **It is stored unclamped and clamped on every read.** On a tool the author
  capped, the row is written, the API answers `200`, and the agent goes on
  asking about the very thing somebody just said always to allow. So the button
  is only offered where a grant would actually take effect, and any tool it
  cannot free is **named** — silently omitting it means you grant, see it ask
  again, and cannot tell a cap from a bug.

### A grant is not instantaneous

The agent pod caches the policies bearing on a run and refreshes **once per
run, with a 30-second TTL**. A message sent within half a minute of a grant
still resolves against the pre-grant snapshot and asks again; the next one does
not. There is a second bound at 300 seconds: a snapshot older than that can
still *refuse* but no longer *grants*, so if the policy store were unreachable,
standing grants degrade to asking rather than silently persisting.

### An automatic approval is still recorded

A policy deciding to allow emits `action_requested` and `action_resolved` with
`automatic` set and the reason attached — "approved automatically, your policy
(t2)" — rather than the call simply never appearing. That is exactly the
distinction between a policy *deciding* to allow and a tool that was never
gated, and it is why declaring a read is not free.

---

## What it deliberately does not do

**It does not touch `/observability` or `/ledger`.** Those prefixes are not
publicly routed, and the one host that did expose them was deleted for that
reason. Traces and platform cost stay the console's job.

The rail *does* show the end user's **credits and statement** — through
`elan.wallets`, which is `/v1/projects/{project}/wallets/…` on the public API,
an authenticated door that checks a token and scopes to a project. The
distinction is the point: a prefix nothing routes is not a shortcut, and an
example is where a shortcut gets copied from. `elan.wallets` also issues no
non-GET at all — the writes live on `elan.credit`, which this app never
imports, because topping up is an administrative act on your own customers and
not something a chat UI does for whoever is looking at it.

The held amount is shown rather than hidden, because a prepaid run RESERVES
before it spends: for the length of a turn the balance is unchanged and the
available figure is lower, and showing only "available" makes that read as money
vanishing and coming back.

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
