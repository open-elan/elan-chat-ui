/**
 * What this agent IS — as the config repo recorded it at deploy time.
 *
 * ── READ FROM WHAT CONFIG SYNC APPLIES ───────────────────────────────────────
 *
 * Not from the deployment table, which records what was last ASKED for. The
 * two differ exactly when something went wrong after the commit, which is the
 * moment anybody looks at a page like this.
 *
 * ── A FACT THAT IS ABSENT IS NOT A FACT THAT IS ZERO ─────────────────────────
 *
 * The recorded manifest is an allow-list, and a target keeps the facts it had
 * until it next MOVES — so an agent redeployed without any source change still
 * carries whatever was recorded the last time its image actually changed. The
 * client renders every missing field as "not recorded" for that reason: a
 * missing price shown as free is a wrong answer where none was available.
 *
 * ── SIGNED IN, THOUGH IT IS NOT PERSONAL ─────────────────────────────────────
 *
 * Nothing here belongs to the caller, but this app's whole shape is that the
 * server holds the credential and the browser holds a ticket. An unauthenticated
 * route here would be the one door that proxies a tenant's deployment data to
 * anybody who can reach the page.
 */

import { NextResponse } from "next/server";

import { elan, target } from "@/lib/elan";
import { failed } from "@/lib/failure";
import { read } from "@/lib/identity";

export async function GET() {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const slug = target();
  try {
    const agent = await elan().agents.get(slug);
    if (!agent) {
      return NextResponse.json(
        { error: `${slug} is not deployed in this project` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      slug: agent.slug,
      project: agent.project,
      version: agent.version,
      // THE POD IT RUNS IN. Itself when it is alone, its group's name when it
      // shares one — which is what says two agents restart together, share a
      // database and scale as one. Invisible from a list that shows them side
      // by side, and the reason a cold start can be somebody else's fault.
      workload: agent.workload,
      manifest: agent.manifest,
    });
  } catch (error) {
    return failed("could not read the agent", error);
  }
}
