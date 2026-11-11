# How it works

This is the detailed companion to the [README](../README.md). The README gets
the app running; this explains what it does behind the page, why each piece is
shaped the way it is, and what to keep when you build your own.

**The browser watches with a ticket; the server acts with a secret.** That
split is the subject of the whole example — not the chat, which is twenty lines
of `<p>` tags. If you take one thing from it, take the split.

- [Who holds what](#who-holds-what)
- [What happens when you send a message](#what-happens-when-you-send-a-message)
- [Identity](#identity)
- [Configuration](#configuration)
- [Conversations, history and liveness](#conversations-history-and-liveness)
- [Pauses and approvals](#pauses-and-approvals)
- [Attachments](#attachments)
- [Permissions: what the agent may do on its own](#permissions-what-the-agent-may-do-on-its-own)
- [Credits and statement](#credits-and-statement)
- [Errors and status codes](#errors-and-status-codes)
- [The traps it is built around](#the-traps-it-is-built-around)
- [Code map](#code-map)
- [What it deliberately does not do](#what-it-deliberately-does-not-do)

---

## Who holds what

There are three parties, and each holds exactly one kind of thing:

| | Holds | Can |
|---|---|---|
| **Browser** | A ticket: short-lived (~300s), for one end user, pinned to one origin | Open `/ws` and watch that end user's runs. Nothing else. |
| **This app's server** | A service user's client id and secret, plus the signed identity cookie it set | Everything that acts: invoke, resume, decide, read history, sign files |
| **Platform** | The agents, the runs, the wallets, the files | — |

A **ticket** opens `/ws` and nothing else. Every other platform route answers
`403` to one. So a browser holding one can *watch* a run and cannot start one,
cannot list approvals, cannot decide one, cannot read a run back, and cannot
store a file.

Everything that **acts** therefore happens in a route handler under
`app/api/`, with the service user's credentials that never leave the server —
including attachments, where the route authorises the transfer and the browser
moves the bytes to or from storage itself:

```
  browser                        this app's server                 platform
  ───────                        ─────────────────                 ────────
  POST /api/session ───────────► sets a signed httpOnly cookie
                                 (who the end user is)

  POST /api/ticket ────────────► tickets.mint(userId, {origin}) ──► /v1/tickets
  ◄──────────── a ~300s ticket

  opens wss://…/ws ─────────────────────────────────────────────► /ws
  (subscribes to the session)

  GET  /api/history ───────────► runs.list + runs.get + toReply ─► /v1/runs

  POST /api/invoke ────────────► runtime.invoke(agent, text, ────► /v1/invocations
                                   {sessionId, endUserId})          202
  ◄═══════════ the reply arrives on the SOCKET, never in a response ═══════════

  POST /api/upload ────────────► artifacts.declareUpload(...) ───► /v1/artifacts/uploads
  ◄──────────── a signed PUT url
  PUT  storage.googleapis.com ──────────────────────────────────► (the bytes, direct)

  GET  /api/download ──────────► artifacts.downloadUrl(...) ─────► signed GET url
  ◄──────────── 302 to storage, no-store

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

### The secret cannot reach the browser

That is structural, not careful. Next only exposes environment variables
prefixed `NEXT_PUBLIC_` to the client bundle, and none of this app's are. The
one value the browser needs — the API's public address — is read by the server
component in [`app/page.tsx`](../app/page.tsx) and handed down as a prop. So
there is no edit to a component that could leak a credential: the build would
inline `undefined`.

Verified rather than asserted: a production build with planted credentials has
none of them anywhere in the client bundle.

### What a visitor cannot do

Each of these is enforced on the server, because each route takes the end user
from the signed cookie and never from the request:

- mint a ticket for somebody else, and so watch their conversations
  ([`/api/ticket`](../app/api/ticket/route.ts));
- read another end user's history, or approve another end user's tool call, by
  guessing a session id ([`/api/history`](../app/api/history/route.ts),
  [`/api/approvals`](../app/api/approvals/route.ts));
- read another end user's balance or statement
  ([`/api/wallet`](../app/api/wallet/route.ts));
- download another end user's attachment, or any of the organisation's shared
  `project:` / `agent:` documents
  ([`/api/download`](../app/api/download/route.ts));
- top up a wallet — the app never imports the SDK's write side for credit.

---

## What happens when you send a message

From opening the page to reading the reply, in order.

**1. The page renders on the server.** [`app/page.tsx`](../app/page.tsx) is a
server component. It reads the identity cookie and `ELAN_API_URL`. With no
`ELAN_API_URL` it renders a "Not configured" card; with no cookie, the sign-in
card; otherwise it renders the workspace inside `Provider`, passing `baseUrl`
and the agent's name as props. The service user's id and secret are never
passed to anything that runs in the browser.

**2. You sign in.** [`SignIn`](../components/SignIn.tsx) POSTs a name to
[`/api/session`](../app/api/session/route.ts). The server chooses the end-user
id — `DEMO_USER_ID` if set, otherwise `demo-<16 hex chars>` — signs it with the
name using `DEMO_SESSION_SECRET`, and sets it as an httpOnly cookie. The page
reloads so the server can read that cookie and render the chat. See
[Identity](#identity).

**3. The socket opens.** [`Provider`](../components/Provider.tsx) wraps the
SDK's `ElanProvider` with a **ticket supplier**: a stable function that POSTs
[`/api/ticket`](../app/api/ticket/route.ts) each time it is called. That route
mints a ticket for the cookie's end user, pinned to the request's own origin,
and returns the ticket and its lifetime — nothing else. The provider opens one
socket to `wss://…/ws` with it, for the whole page, and calls the supplier
again on every reconnect, because a ticket lives about five minutes.

**4. A conversation is chosen.** [`Workspace`](../components/Workspace.tsx)
reads the conversation list from `localStorage`
([`lib/sessions.ts`](../lib/sessions.ts)) and opens the newest, or makes a new
one with an id the app generates. [`Chat`](../components/Chat.tsx) then does
two things for that session id: subscribes with `useAgentEvents(sessionId)` for
what happens from now on, and fetches
[`/api/history`](../app/api/history/route.ts) for what was said before.

**5. The composer unlocks.** It stays disabled, with the placeholder
"connecting…", until the stream reports `ready`. That ordering is not
cosmetic: a reply published before the socket has subscribed is discarded, so
sending early would lose it. See [the traps](#the-traps-it-is-built-around).

**6. You press send.** If you attached files, they are already stored — upload
happens when you pick the file, not when you send. `announce()` in
[`lib/upload.ts`](../lib/upload.ts) appends their names to your text. `Chat`
POSTs `{text, sessionId}` to [`/api/invoke`](../app/api/invoke/route.ts), which
calls:

```ts
elan().runtime.invoke(ELAN_TARGET, text, { sessionId, endUserId: who.userId })
```

The platform answers `202` with an `invocation_id`. **Nothing has run yet, and
there is no reply in this response** — there is no route that would give one.

**7. Your message appears at once.** The browser shows an optimistic echo of
what you sent, keyed on the invocation id. It has to: the `queued` event
arrives quickly but carries no text, and `started` carries the text but cannot
arrive until a pod exists — on a cold start that can be a while. The first
message in a conversation also becomes its title in the sidebar.

**8. Events arrive on the socket.** Addressed to `eu:<your id>`, so they reach
the socket holding your ticket. The kinds this app reads include:

| Event | What the UI does with it |
|---|---|
| `queued` | The turn exists; the echo lends it its text. |
| `started` | Carries the message that began the run, so your turn is in the stream too. |
| `typing` | Its `label` ("Agent is searching unpaid invoices…") becomes the liveness line. |
| `tool_call` / `tool_result` | Paired on the call id and shown as "Used …" under the reply. |
| `content` | The reply. Text is at `payload.content.parts[*].text`, joined by the SDK's `textOf`. |
| `finished` / `error` | The turn is settled. |
| `paused` | The run stopped to wait for somebody. See [Pauses and approvals](#pauses-and-approvals). |

**9. The transcript is folded, not appended.** History and live events go
through one fold in `Chat`, grouped by invocation and sorted by time. A run
that appears in both becomes one turn, and recorded runs come back from
`/api/history` already in the stream's own shape, so there is one renderer
rather than two that disagree.

**10. The rail catches up.** When a run reaches a terminal event, the
[`Wallet`](../components/Wallet.tsx) panel reads
[`/api/wallet`](../app/api/wallet/route.ts) again, so the balance and statement
reflect what the turn cost.

---

## Identity

[`lib/identity.ts`](../lib/identity.ts) decides who the visitor is. The server
decides it, never the browser, and that is the property everything else rests
on: a ticket is minted *for* an end user and whoever holds it sees that end
user's runs. If the browser could name its own `end_user_id` — one extra field
on `/api/ticket` — any visitor could mint a ticket for anybody.

### The cookie

| | |
|---|---|
| Name | `elan_demo_user` |
| Value | `<userId>|<base64url label>.<HMAC-SHA256 signature>` |
| Signed with | `DEMO_SESSION_SECRET` |
| Flags | `httpOnly`, `SameSite=Lax`, `path=/`, 7 days |
| `Secure` | Only when `NODE_ENV=production` |

`Secure` is off in development on purpose. A `Secure` cookie is *stored* over
`http://localhost` and never *sent*, which is a silent failure: you sign in,
and every request afterwards is anonymous.

The signature is compared in constant time, and a signature of the wrong length
is a rejection rather than a crash (`timingSafeEqual` throws on unequal lengths
instead of returning false).

### The end-user id

An id must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. In particular it **may not
contain a colon**: a ticket's subject is composed as `eu:<id>`, and the platform
splits on the first one.

Without `DEMO_USER_ID`, each sign-in gets a random `demo-<hex>` id rather than
the name typed, because two visitors may both call themselves "Ada" and their
runs and wallets must not merge. With `DEMO_USER_ID`, every sign-in uses that id
— see [Credits and statement](#credits-and-statement) for why you would want
that.

### This is a demo identity, not authentication

`/api/session` has no password, no provider and no verification — anyone can
claim a name. Swap `read()` in [`lib/identity.ts`](../lib/identity.ts) for your
own session, and [`SignIn`](../components/SignIn.tsx) and
[`/api/session`](../app/api/session/route.ts) for your own sign-in, and
**nothing else changes**, because every route asks *who is the caller* rather
than trusting what the caller says.

What the cookie buys even as a demo is the property a real deployment needs: a
visitor cannot name a *different* end user than the one they claimed, so they
cannot mint a ticket for somebody else's conversations.

---

## Configuration

All configuration is server-side environment variables in `.env.local`. None is
prefixed `NEXT_PUBLIC_`, so none reaches the browser. The `ELAN_*` names are
the SDK's own, so `ElanClient` and the `elan` CLI agree about them.

| Variable | Required | What it is |
|---|---|---|
| `ELAN_API_URL` | Yes | The platform's base URL: `https://api.openelan.ai`. The only value handed to the browser, as a prop. |
| `ELAN_PROJECT` | Yes | Your project's slug. **Empty means the *platform's* project**, which is not yours, and surfaces as a bare `502`. |
| `ELAN_CLIENT_ID` / `ELAN_CLIENT_SECRET` | Yes | A service user, from the console's API access page or `POST /v1/projects/{project}/service-users`. |
| `ELAN_TARGET` | Yes | The slug of the agent this chat talks to. |
| `DEMO_SESSION_SECRET` | Yes | Signs the identity cookie. `openssl rand -hex 32`. |
| `DEMO_USER_ID` | No | Pins every sign-in to one end-user id. **The one you want if you have opened a wallet.** |

**The service user must be a tenant admin.** Minting tickets is an admin
capability — `POST /v1/tickets` refuses a plain member — and so is the tenant
scope `/api/approvals` needs to find an end user's confirmations.

**One client per process.** [`lib/elan.ts`](../lib/elan.ts) builds a single
`ElanClient` and keeps it, because the client caches its access token and
refreshes it *before* it expires. A client per request would mint a new token
for every message.

**A missing variable is a `500` that names it**, not a `502`: the request
reached nothing, because this app was not given what it needs. See
[Errors and status codes](#errors-and-status-codes).

---

## Conversations, history and liveness

**The sidebar is the app's own list, because the platform has none to give.** A
session id is yours to choose — nothing mints one — and no route enumerates
them. `GET /v1/sessions` reads the *platform's* database, so for a tenant's
agents it correctly and permanently reports nothing; `GET /v1/runs` lists runs
rather than conversations, has no user filter, and pages 25 rows across every
end user in the project. So [`lib/sessions.ts`](../lib/sessions.ts) keeps the
list in `localStorage`, and in a real app **that file is your database**, keyed
by your own user id.

The list lives in the browser, so it **outlives a change of identity**. A
conversation started under a different `DEMO_USER_ID` is still listed, and
opening it says that nothing is readable under the current identity — because
history correctly refuses it.

**What each conversation SAID comes back from the record**, through
[`/api/history`](../app/api/history/route.ts) — because nothing buffers a
stream for a socket that was not open, so without it every chat but the active
one would render empty.

> **`GET /v1/runs` is newer than some deployments.** A platform whose image
> predates it answers `404` and history cannot be read back. The route reports
> that **once**, in words that name the fix, and the chat carries on live —
> rather than showing an empty transcript and letting somebody conclude their
> conversation was lost. A deployment with no observability service answers
> `501` and is reported the same way.

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

**History arrives grouped by run, so the transcript sorts by time.** A
continuation answered half an hour later sits inside its own run's block, which
is positioned where that run *started*; without sorting, an answer would render
above the message it followed.

**One socket, many conversations.** Switching conversations changes the
argument to `useAgentEvents`. The stream reference-counts its per-session
handlers, so the old subscription is dropped and the new one added without the
socket being touched. `Chat` is keyed on the session id, so it remounts rather
than carrying the previous conversation's echoes and scroll position across.

**`typing` events drive the liveness line.** The platform's typing plugin emits
`{state, subject, label}` where `label` is a ready-made sentence — "Agent is
thinking…", "Agent is searching unpaid invoices…" — so a client does not invent
phrasing and a translation has somewhere to live. It deliberately emits no
`idle` after the model returns, because `content`, `finished` and `error`
already mean clear; the fold walks events in order for exactly that reason, so
the indicator clears when the agent speaks and returns when it goes quiet.

**A settled turn shows what the agent did.** `tool_call` and `tool_result`
events carry ADK's own `function_call` / `function_response` parts, so
[`lib/tools.ts`](../lib/tools.ts) pairs them **on the call id and never on
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

### Rendering

**The agent's replies render as markdown**
([`Markdown.tsx`](../components/Markdown.tsx)), because a model writes it
whether or not you render it: shown as plain text, a good answer arrives as
`**Total:** £420` with literal `1.` list markers. **Raw HTML inside a reply is
not rendered** — `react-markdown` without `rehype-raw` — and that default is the
reason to use it rather than `dangerouslySetInnerHTML`: a reply is untrusted
text, since it can repeat anything a user typed or a tool fetched. Verified: an
`<img src=x onerror=…>` in a reply comes out as escaped characters, not an
element. If you ever add `rehype-raw`, add a sanitiser with it.

**Your own messages render as plain text** ([`Said.tsx`](../components/Said.tsx)),
because a person typing does not write markdown: rendering it would eat their
asterisks and turn a line starting `# ` into a heading. The one exception is
attachment names, which become download links — see
[Attachments](#attachments).

---

## Pauses and approvals

A run can stop to wait for somebody. There are three kinds of pause, and each
needs a different answer, so [`Approvals.tsx`](../components/Approvals.tsx)
asks which kind it is rather than offering one pair of buttons for all three:

| Kind | What is waiting | How it is answered |
|---|---|---|
| `input` | A workflow node wants a **value** | `POST /api/resume` with a `payload` |
| `confirmation` | A person must approve a **tool call** | `POST /api/approvals`, which decides the whole **batch** |
| `tool` | An external system owes a **result** | Not from this UI: your backend calls `elan.tools.submit(callId, …)`, and a deadline abandons the call if nobody does |

**A paused run emits two `paused` events and no `finished` at all.** The pause
*is* where the run stopped, deliberately: a human approval can outlast any ack
deadline. Only the engine's synthesised pause carries `interrupt_kind` — ADK's
own names no interrupt — and a `content` event can sit *between* the two, so
"the last paused" is not even a positional rule. `Approvals` discriminates on
that payload key.

### Confirmations

[`/api/approvals`](../app/api/approvals/route.ts) lists what a run is waiting on
and decides it. It is a server route because a decision is an authorisation —
it causes a tool to run.

- **It reads at tenant scope, and has to.** A confirmation raised by an end
  user's run is recorded against `eu:<id>`, not against the service user that
  published it, so the default `scope: "mine"` finds none of them — and the
  card renders with no Approve button and no error, which reads as "the agent
  never asks".
- **So it proves ownership.** Tenant scope returns *every* end user's actions,
  and an action row carries no `user_id`. It does carry an `invocation_id`, so
  the route reads the session's runs first, checks each belongs to the caller,
  and shows or decides only actions whose invocation is in that set. Without
  that, a guessed session id would be enough to approve somebody else's tool
  call.
- **A turn's answers travel as one batch.** One model turn can raise several
  confirmations, and the next message resolves every one it raised. Answer one
  of two and the other is silently abandoned while the run reports finished. So
  the route calls `decideBatch`, and `published` is what says anything actually
  ran.
- **`abandoned` can follow an approval**, because the engine refuses a batch
  with a later user turn. It means nothing ran, and is reported as such rather
  than shown as a tick.
- **The pause can reach the browser before the action row exists.** The socket
  relays the pause straight away while the actions service is still committing
  the row, so the card retries on a short schedule, stops on the first hit, and
  says so in a sentence if it never arrives.

### Workflow input

[`/api/resume`](../app/api/resume/route.ts) answers a workflow that stopped to
ask.

- **A resume carries data, not just consent.** `payload` becomes the paused
  node's own output, verbatim, and flows to the next node — so a node that asked
  for a cost centre or a corrected address can be answered with one.
  `approved`, `note` and the decider are set by the service and win over
  anything sent, because attribution for a human decision must not be
  forgeable.
- **You state only your answer.** Which workflow, whose session and which
  interrupt come from the recorded run, so guessing an invocation id gets you
  nothing.
- **It can be refused for funds where the first turn was not.** A pause settles
  what the turn used and holds nothing, so the resumed turn reserves on its own
  merits. If the balance ran out in between, this answers `402`.
- **The continuation arrives on the socket** under the same `invocation_id`,
  with `segment` set to the interrupt id, and renders as its own bubble.

---

## Attachments

The paperclip stores a file and names it in the next message. Storing and
sending are separate requests that fail for different reasons, so they get
separate errors.

### Upload: the bytes never pass through this app

1. You pick a file. The browser measures it.
2. [`/api/upload`](../app/api/upload/route.ts) authorises **one** transfer with
   `artifacts.declareUpload`, and answers with a URL signed for exactly that
   file name, byte length and content type.
3. The browser `PUT`s the bytes directly to storage.
4. A chip appears above the composer. The file is now on the platform.
5. When you send, `announce()` writes the names into the message:
   `"…\n\n(attached file: receipt.jpg)"`, or
   `"Please look at the attached file: receipt.jpg"` if you typed nothing.

So an attachment is not bounded by whatever body limit this server has, and
this app never holds a customer's file.

**The size is the authorisation.** The signed URL pins the exact byte length
and content type, and storage refuses a `PUT` of a different length — so the
browser cannot declare a guess and stream whatever arrives, and a file that
changes between choosing and sending is refused rather than stored wrong.

**Removing a chip says "don't mention", not "delete"**, because the bytes are
already stored; the chip only controls whether the next message names them. A
refused invocation leaves the chips in place, since re-uploading would store a
second copy with a second version number.

### Why the name in the message is enough

There is no file field on an invocation — an invocation carries text, and a new
field on that envelope would be rejected by every already-deployed agent image
— so the name travels in the sentence.

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
stored name exactly — `receipt.jpg`, not "the receipt I just sent" — and
nothing errors when it does not.

### The bucket has to allow this app's origin

The browser `PUT`s cross-origin to Google, so the **agent's** project must
declare this app's origin:

```yaml
# in the AGENT's elan.yaml, not this repo
artifacts:
  origins: ["https://chat.example.com", "http://localhost:3002"]
```

Miss it and the `PUT` fails as an indistinguishable network error — no status,
no body, nothing in any log on either side. [`lib/upload.ts`](../lib/upload.ts)
catches that one case and says which file to go and edit, because a bare
`TypeError: Failed to fetch` sends you to read your own code.

### Download: a link that keeps working

In a sent message, each attachment name is a link to
`/api/download?filename=…&session=…`. Clicking it:

1. [`/api/download`](../app/api/download/route.ts) checks the cookie, refuses
   reserved or path-like names, and calls `artifacts.downloadUrl` for the
   **caller's own** file.
2. It answers `302` to a short-lived signed URL, with `Cache-Control: no-store`.
3. The browser fetches the bytes from storage, in a new tab, saved under the
   file's real name.

**The link points at this app, not at storage.** A signed URL lives about five
minutes and a transcript lives as long as the conversation, so a signed URL
written into a message would be dead by the time anybody scrolled back to it.
This route is stable and signs per click — which is also why the redirect must
not be cached: a cached `302` would pin one short-lived URL into the browser.

**The names are read back from the text.** A transcript fetched from the server
is text and nothing else, so [`Said.tsx`](../components/Said.tsx) parses the
sentence `announce()` wrote (`attachedIn` in `lib/upload.ts`, kept beside
`announce` because it is its inverse). That is what makes a link work for a
message sent last week, not only one sent in this tab. Text that merely looks
like a filename — "see report.pdf on my desk" — gets no link.

**No CORS is involved in a download.** It is a navigation, not a cross-origin
`fetch`, so `artifacts.origins` does not apply. Only the upload needs it.

### What is stored, and for how long

An attachment is **session-scoped**: it belongs to this conversation and this
end user, and another visitor cannot see it. Both `/api/upload` and
`/api/download` refuse names beginning `project:`, `agent:` or `user:` — those
address the organisation's own standing documents, and the
credential this app holds is project-scoped, so without the refusal a visitor
could fetch a shared document by guessing its name.

Retention is per project (`artifacts.retentionDays` in the agent's
`elan.yaml`), so an old conversation's files are expected to expire while its
transcript remains. **The link stays rendered** and the route explains on click
that the file may have been deleted — a missing link would read as "this was
never attached".

---

## Permissions: what the agent may do on its own

The rail carries two panels about the agent itself — **About this agent**
([`AgentCard.tsx`](../components/AgentCard.tsx)) and **Action settings**
([`Permissions.tsx`](../components/Permissions.tsx)). The second is the
interesting one, and it is the part of this example most likely to be built
wrong in a real app.

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

[`lib/permissions.ts`](../lib/permissions.ts) folds the two. It reproduces the
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

The approval card and the settings panel stay in step through one shared
browser event ([`lib/changed.ts`](../lib/changed.ts)), so a grant made from the
card shows in the panel without a reload.

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

## Credits and statement

The [`Wallet`](../components/Wallet.tsx) panel shows the end user's balance and
their latest 20 statement entries, read through
[`/api/wallet`](../app/api/wallet/route.ts).

**A wallet is keyed on the external user id.** So the random `demo-<hex>` id a
sign-in generates can never match one you created: the lookup resolves nothing,
the run falls back to the tenant's token balance, and no wallet is charged.
Nothing errors, which is what makes it worth saying. If you have run
`elan wallet new demo-wallet`, set `DEMO_USER_ID=demo-wallet` and every run in
this app is funded by that wallet. The rail shows which id is in play, under
"Watching as".

`DEMO_USER_ID` is a **server** variable and not a request field, so a visitor
still cannot point the app at somebody else's wallet. No wallet at all is
shown as a state, not a failure — it is how every demo starts.

**The held amount is shown, not hidden.** A prepaid run *reserves* before it
spends: for the length of a turn the balance is unchanged and the available
figure is lower. Showing only "available" makes that read as money vanishing
and coming back. It also keeps the refresh honest: the panel refetches when a
run reaches a terminal event, which can land while the settle is still in
flight, so a figure read in that instant may still carry the hold — visible and
explainable rather than wrong.

**Statement lines are exact to the micro-dollar.** The ledger stores micro-USD
and a per-run settle is sub-cent: `-7749`, `-5409`, `-2374` and `-2682`
micro-USD round to `-$0.01`, `-$0.01`, `-$0.00`, `-$0.00` — four rows that
differ by 3x, shown as two values. So the statement shows all six places, via
the SDK's `dollars()`, which is integer arithmetic to a string rather than a
floating-point division nobody can reconcile.

**It only reads.** `elan.wallets` issues no non-GET; the writes live on
`elan.credit`, which this app never imports. Topping up is an administrative act
on your own customers, not something a chat UI does for whoever is looking at
it. And it goes through the public API — `/v1/projects/{project}/wallets/…`,
which checks a token and scopes to a project — never the ledger directly.

---

## Errors and status codes

Every route turns a thrown error into a status through
[`lib/failure.ts`](../lib/failure.ts), so the status points at where the
problem is. The first version answered `502` for everything, and its very first
request returned `502 ELAN_CLIENT_ID is not set` — a status that sends you to
look at the platform for a problem in your own `.env.local`.

| Status | Means | Look at |
|---|---|---|
| `400` | The request was missing something (no text, no session id, a reserved file name) | The request |
| `401` | Not signed in — no valid identity cookie | Sign in again; check `DEMO_SESSION_SECRET` has not changed |
| `402` | The end user's wallet, or the tenant's balance, will not cover the run | Top up; a resume can hit this where the first turn did not |
| `409` | Somebody, or the engine's own abandonment, decided it first | Nothing to retry |
| `500` | This app is misconfigured; the message names the variable | `.env.local` |
| `502` | The platform refused or could not be reached; its message is passed through | The message — the platform's refusals are written for a developer |

In the page, both show at the foot of the transcript, just above the composer:
a refused request as its message, and a socket problem as a `socket: …` line.

---

## The traps it is built around

Each of these cost somebody real time before it was written down.

| Trap | What this app does about it |
|---|---|
| **Subscribe before you invoke.** Pub/Sub discards a message published to a topic with no subscription, and rt-service creates the tenant's when its first socket opens — so a client that invokes and *then* connects loses the whole reply on a warm agent. | The composer is disabled until the stream reports `ready`. |
| **A ticket is a supplier, not a string.** It lives about five minutes and the socket reconnects with backoff, so a cached one is refused on the first reconnect — as a `1008` close, which reads like a broken credential. | `ElanProvider` takes `() => Promise<string>`; `/api/ticket` is asked again on every connect. |
| **The supplier must be a stable reference.** The provider opens its socket in an effect keyed on the supplier, so a fresh function each render tears the socket down every render — dropping whatever arrived in the gap, which on a warm agent is the reply. | `useCallback` with no dependencies in `Provider.tsx`. |
| **`origin` is pinned exactly and a suffix does not count.** A ticket minted for `https://example.com` is refused from `https://evil.example.com`, as a `1008` on connect rather than an error at mint. | Minted from the request's own origin, so there is no setting to get wrong. |
| **A reply is at `payload.content.parts[*].text`** and the parts must be **joined** — `payload.text` does not exist on a content event, and reading it finds nothing on every one of them. | `textOf` is imported from the SDK, never reimplemented. |
| **A paused run emits two `paused` events and no `finished` at all.** Only the engine's synthesised one carries `interrupt_kind`, and a `content` event can sit *between* the two. | `Approvals` discriminates on the payload key. |
| **A turn's answers travel as one batch.** Answer one of two confirmations and the other is silently abandoned while the run reports finished. | `decideBatch` on every action in the batch, and `published` is what says anything ran. |
| **An `abandoned` status can follow an approval** — the engine refuses a batch with a later user turn — and it means nothing ran. | Reported rather than shown as a tick. |
| **A resume carries data, not just consent.** `payload` becomes the paused node's own output and flows to the next node. | The `input` card sends a value. |
| **A resume can be refused for funds where the first turn was not.** A pause settles and holds nothing, so the resumed turn reserves on its own merits. | `/api/resume` maps that to a `402`. |
| **`actions.batches` defaults to `scope: "mine"`,** and a confirmation raised by an END USER's run is recorded against `eu:<id>`. The default finds none of them, and the card renders with no Approve button and no error. | Tenant scope, which this credential already has. |
| **…and tenant scope returns EVERY end user's actions.** The action row carries no `user_id` to filter on. | The session's runs are read first, each checked against `eu:<caller>`, and only actions whose invocation is in that set are shown or decided. |
| **The browser learns of a pause BEFORE the action row exists.** rt-service relays the pause straight down the socket while actions-service has to commit a row. | A short retry schedule, stopping on the first hit, and a sentence rather than a silent empty card if it never arrives. |
| **A standing grant is stored unclamped and clamped on read.** "Always approve" on a tool the author capped is written, accepted, and then has no effect. | The button is offered only where the ceiling permits, and a tool it cannot free is named. |
| **A grant takes effect within ~30s, not instantly.** The pod refreshes its policy snapshot once per run on a 30-second TTL. | Worth knowing before you conclude a grant did not save. |
| **The recorded manifest only changes when a target MOVES.** A redeploy with no source change keeps the facts it had. | A new manifest field reaches an agent on its next real deploy, not on the next `elan deploy`. |
| **A `Secure` cookie is stored over http and never sent.** You sign in, and every request afterwards is anonymous. | `Secure` only in production. |
| **A signed download URL dies in about five minutes**, long before anyone scrolls back to the message that held it. | Messages link to `/api/download`, which signs per click and is never cached. |

---

## Code map

Nothing here is framework-clever. The server routes are the product; the
components are a thin reading of an event stream.

### Server

| | |
|---|---|
| [`lib/elan.ts`](../lib/elan.ts) | The one module holding a secret. One client per process, because it caches the token. Reads the ticket's origin from the request. |
| [`lib/identity.ts`](../lib/identity.ts) | Who the end user is, from a signed httpOnly cookie. **Replace this with your auth.** |
| [`lib/failure.ts`](../lib/failure.ts) | A thrown thing → a status a reader can act on. Not everything is a `502`. |
| [`app/page.tsx`](../app/page.tsx) | The server component that decides what the browser is given: `baseUrl` and the agent's name, never the credentials. |
| [`app/layout.tsx`](../app/layout.tsx) | The shell, and an inline script that applies the saved theme before first paint. |
| [`app/api/session`](../app/api/session/route.ts) | Claim a demo identity. **The one route to replace.** |
| [`app/api/ticket`](../app/api/ticket/route.ts) | Mint the browser's ~300s stream credential, for the cookie's user only. |
| [`app/api/invoke`](../app/api/invoke/route.ts) | Start a run, naming the end user. Answers `202`; the reply comes on the socket. |
| [`app/api/resume`](../app/api/resume/route.ts) | Answer a workflow input pause with data. |
| [`app/api/approvals`](../app/api/approvals/route.ts) | List what a run is waiting on, and decide a whole batch, after proving ownership. |
| [`app/api/history`](../app/api/history/route.ts) | The durable read, with the ownership check that must precede it. |
| [`app/api/agent`](../app/api/agent/route.ts), [`/permissions`](../app/api/permissions/route.ts) | The agent's card; what it may do and what this person allowed. |
| [`app/api/wallet`](../app/api/wallet/route.ts) | Credits and statement. Read-only by construction. |
| [`app/api/upload`](../app/api/upload/route.ts) | Authorises ONE attachment. The bytes never pass through it. |
| [`app/api/download`](../app/api/download/route.ts) | Signs one read per click and redirects to it. Never cached. |

### Browser

| | |
|---|---|
| [`components/Provider.tsx`](../components/Provider.tsx) | The one socket, and the stable ticket supplier. |
| [`components/SignIn.tsx`](../components/SignIn.tsx) | The demo sign-in card. **Throw away in a real app.** |
| [`components/Workspace.tsx`](../components/Workspace.tsx) | The rail and the transcript, and which conversation is active. |
| [`components/Sessions.tsx`](../components/Sessions.tsx) | The conversation list in the rail. |
| [`components/Chat.tsx`](../components/Chat.tsx) | One conversation: history + live events folded into turns, the composer, attachments. |
| [`components/Said.tsx`](../components/Said.tsx) | Your own message, as plain text, with attachment names as download links. |
| [`components/Markdown.tsx`](../components/Markdown.tsx) | The agent's reply, as markdown, with raw HTML not rendered. |
| [`components/Tools.tsx`](../components/Tools.tsx) | What the agent did in a turn. |
| [`components/Approvals.tsx`](../components/Approvals.tsx) | The three kinds of pause, and the different call each needs. |
| [`components/AgentCard.tsx`](../components/AgentCard.tsx), [`Permissions.tsx`](../components/Permissions.tsx) | The two rail panels about the agent itself. |
| [`components/Wallet.tsx`](../components/Wallet.tsx) | Balance, hold and statement, refreshed after each run. |
| [`components/ThemeSwitch.tsx`](../components/ThemeSwitch.tsx) | System, light or dark. |

### Shared, no React

| | |
|---|---|
| [`lib/sessions.ts`](../lib/sessions.ts) | The conversation list, in `localStorage`. **In a real app this is your database.** |
| [`lib/tools.ts`](../lib/tools.ts) | Pairs `function_call` with `function_response` on the call id. |
| [`lib/permissions.ts`](../lib/permissions.ts) | Folds the declaration and the stored grants into one row per tool. |
| [`lib/changed.ts`](../lib/changed.ts) | One event name, so the approval card and the settings panel agree. |
| [`lib/upload.ts`](../lib/upload.ts) | Authorise, then PUT; `announce()` and its inverse `attachedIn()`. Names the CORS cause. |
| [`lib/theme.ts`](../lib/theme.ts) | The saved theme choice, applied as `data-theme` on `<html>`. |

### What to read, in order

1. **[`lib/elan.ts`](../lib/elan.ts)** — the only module that holds a secret,
   and why `origin` is read from the request rather than configured.
2. **[`lib/identity.ts`](../lib/identity.ts)** — why the end user's id is the
   server's and never the browser's. **The one file to replace** with your own
   auth.
3. **[`app/api/ticket/route.ts`](../app/api/ticket/route.ts)** — minting the
   browser's credential, and the field it deliberately does not accept.
4. **[`components/Provider.tsx`](../components/Provider.tsx)** — the ticket
   **supplier**, and why it must be a stable reference.
5. **[`components/Chat.tsx`](../components/Chat.tsx)** — `useAgentEvents`, the
   composer that waits for the socket, and why the transcript is folded from
   events rather than kept in a local list.
6. **[`components/Approvals.tsx`](../components/Approvals.tsx)** — the three
   kinds of pause and the different call each one needs.
7. **[`app/api/history/route.ts`](../app/api/history/route.ts)** — the durable
   read, and the ownership check that has to happen before it.
8. **[`lib/sessions.ts`](../lib/sessions.ts)** — why the conversation list is
   **yours** and not the platform's.
9. **[`lib/tools.ts`](../lib/tools.ts)** — pairing a tool's call with its
   result, and why the fold has no React in it.
10. **[`app/api/permissions/route.ts`](../app/api/permissions/route.ts)** — the
    two sources a permissions page needs, and why neither alone is honest.
11. **[`lib/permissions.ts`](../lib/permissions.ts)** — the resolution order as
    far as a page can know it, and the one step it deliberately cannot do.
12. **[`lib/failure.ts`](../lib/failure.ts)** — why a thrown thing is not always
    a `502`, learned by answering one for a fault in `.env.local`.

### Scripts

| | |
|---|---|
| `pnpm dev` | Development server on port 3002. |
| `pnpm build` / `pnpm start` | Production build, and serve it on port 3002. |
| `pnpm typecheck` | `tsc --noEmit`. |

**There are no tests.** The gates are `pnpm typecheck` and `pnpm build`, and
the typecheck is the one that matters: it binds against the SDK's real types,
so a field that moves is a compile error here. That is the entire reason this
example *imports* the wire types instead of mirroring them — the app it
replaces hand-mirrored them, lost three fields, invented a fourth, and every one
of those four mistakes typechecked.

---

## What it deliberately does not do

**It does not touch `/observability` or `/ledger`.** Those prefixes are not
publicly routed, and the one host that did expose them was deleted for that
reason. Traces and platform cost stay the console's job. The wallet panel goes
through `elan.wallets` on the public API instead — a prefix nothing routes is
not a shortcut, and an example is where a shortcut gets copied from.

**It does not top up wallets.** `elan.credit` is never imported.

**It does not use `useRun`**, even though `elan-sdk/react` exports it. A
provider given only a `ticket` installs a placeholder token for the HTTP side —
a ticket is not a credential HTTP may use — so `useRun` would call
`runs.get()` with something that reaches nothing and 401. That hook is for the
console's cookie credential. If you need the durable read ("my socket
dropped"), add a server route that calls `runs.get()` with the service user, as
`/api/history` does.

**It does not answer `tool` pauses.** An external system owes those a result,
and your backend submits it with `elan.tools.submit(callId, …)`; a person in a
chat box cannot.

**It is not in the platform's CI.** Nothing stops it drifting from the SDK it
imports; the mitigation is structural rather than procedural — the typecheck
above.
