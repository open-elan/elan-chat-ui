/**
 * What a conversation already said, read back from the record.
 *
 * ── THE ANSWER TO "MY SOCKET WAS NOT OPEN" ───────────────────────────────────
 *
 * Nothing buffers events for a socket that is not connected: rt-service creates
 * the tenant's subscription on the first socket and deletes it about two
 * minutes after the last, and there is no replay, seek or snapshot anywhere.
 * So the stream is the LIVE path and never the durable one — reopening it shows
 * only what happens NEXT. Without this route, every conversation in the sidebar
 * but the active one would render empty.
 *
 * ── AND IT IS A SERVER ROUTE BECAUSE A TICKET CANNOT READ IT ─────────────────
 *
 * `GET /v1/runs` needs a credential with reach, which a ticket has not. The
 * SDK's `useRun` hook exists for the console's cookie and would 401 under a
 * ticket-only provider, so the durable read belongs here.
 *
 * ── OWNERSHIP IS CHECKED BEFORE ANYTHING IS RETURNED ─────────────────────────
 *
 * A session id is a string this app chose, so it is guessable, and the service
 * user can read every run in the project. An end-user run is attributed to
 * `eu:<id>`, so every run in the page must belong to the caller or the whole
 * request is a 404 — "no such thing, for you", which is how the platform's own
 * routes answer it.
 *
 * `runs.list` HAS NO USER FILTER, which is why the scope is the SESSION and the
 * check is explicit. Filtering a project-wide page by user client-side would be
 * worse than it looks: the page is 25 rows across every end user, so an active
 * project could push a caller's own runs off it entirely and this would answer
 * "no history" for a conversation that has plenty.
 */

import { NextResponse } from "next/server";
import { NotFound, NotWired, toReply, type AgentEvent } from "elan-sdk";

import { elan } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

/** How many runs of one conversation to read back. */
const RUNS = 50;

export async function GET(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "no sessionId" }, { status: 400 });
  }

  const mine = `eu:${who.userId}`;

  try {
    const page = await elan().runs.list({ sessionId, limit: RUNS });

    // THE CHECK, BEFORE THE FETCH BELOW. Not after it, and not interleaved:
    // the point is that nothing about somebody else's conversation is read,
    // not merely that it is left out of the response.
    const stranger = page.runs.find((run) => run.user_id !== mine);
    if (stranger) {
      return NextResponse.json({ error: "no such conversation" }, { status: 404 });
    }

    // OLDEST FIRST, so the transcript reads downwards. `started_at` can be null
    // on a run that was queued and never started, which sorts to the front.
    const ordered = [...page.runs].sort((a, b) =>
      String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")),
    );

    // ONE REQUEST PER RUN, because `GET /v1/runs` returns the rows and not
    // their events. Fine for a conversation and not for a dashboard; a real app
    // with long histories would page this rather than fetch all of it.
    const full = await Promise.all(
      ordered.map((run) => elan().runs.get(run.invocation_id)),
    );

    // `toReply` FILLS THE IDENTITY BACK IN. A recorded event is abbreviated —
    // `{seq, segment, kind, payload, emitted_at}` — because the run carries
    // the rest once instead of repeating it per row. Folding them here is what
    // lets the page render history and live events with ONE code path.
    const events: AgentEvent[] = full.flatMap((run) => [...toReply(run).events]);

    return NextResponse.json({ events });
  } catch (error) {
    // ── A PLATFORM THAT CANNOT SERVE HISTORY IS NOT A FAILURE HERE ──────────
    //
    // `GET /v1/runs` arrived with the SDK (ADR-0110 gave it the project scope
    // it needs), so a deployment whose image predates that answers 404 for a
    // path it has never heard of — the route falls to deploy-service's
    // catch-all, which is where it lives, and FastAPI has no handler. A
    // deployment with no observability service answers 501.
    //
    // Neither should stop the chat working. They are reported ONCE, in words
    // that name the fix, and the conversation carries on live — which is the
    // only part that was ever available on a fresh session anyway.
    if (error instanceof NotFound) {
      return NextResponse.json({
        events: [],
        unavailable:
          "this platform does not serve GET /v1/runs yet, so past " +
          "conversations cannot be read back. Deploy the services that carry " +
          "it and history appears; live replies work regardless.",
      });
    }
    if (error instanceof NotWired) {
      return NextResponse.json({
        events: [],
        unavailable:
          "this deployment has no observability service, so nothing records " +
          "what a run did. Live replies work regardless.",
      });
    }
    return failed("could not read the conversation", error);
  }
}
