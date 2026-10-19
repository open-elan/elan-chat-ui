/**
 * What this agent may do, and what this person has let it do unattended.
 *
 * ── TWO SOURCES, AND NEITHER ALONE IS HONEST ─────────────────────────────────
 *
 *   /v1/agents              what the AUTHOR declared — tier, ceiling, refusals
 *   /v1/autonomy/policies   what the PERSON stored — their grants, and the cap
 *
 * Showing only the second is the trap. A stored policy is clamped to the
 * tool's declared `ceiling`, and `stored_shape` strips a caller's ceiling on
 * the way in so the author's is re-imposed on every call — so a page built on
 * grants alone shows somebody their own `t2` beside a tool that keeps asking,
 * with nothing on screen to account for the difference. The declaration is
 * what accounts for it.
 *
 * ── WHY THIS IS A SERVER ROUTE ───────────────────────────────────────────────
 *
 * Both routes refuse a ticket, and an end user HAS no credential but a ticket.
 * ADR-0115 made autonomy per-subject precisely so a backend can read and write
 * these on a customer's behalf; this app is that backend.
 *
 * ── THE SUBJECT IS THE COOKIE, NEVER A PARAMETER ─────────────────────────────
 *
 * `eu:<id>` is taken from the signed httpOnly cookie. As a query parameter it
 * would let any visitor read — and revoke — anybody's permissions, because the
 * service credential is allowed to name any end user it likes.
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
  const subject = `eu:${who.userId}`;

  try {
    const [agent, scopes] = await Promise.all([
      elan().agents.get(slug),
      elan().autonomy.policies({ target: slug, user: subject }),
    ]);

    if (!agent) {
      return NextResponse.json(
        { error: `${slug} is not deployed in this project` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      slug,
      display_name: agent.manifest.display_name ?? slug,
      version: agent.version,
      // ABSENT MEANS NOT RECORDED. A target deployed before these were kept
      // has none, and the page says so rather than reporting "declares
      // nothing" — which would be a wrong answer where none was available.
      default_tier: agent.manifest.default_tier ?? "",
      acting_tools: agent.manifest.acting_tools ?? null,
      declared: agent.manifest.action_policies ?? null,
      // `mine` IS THIS END USER'S, because `subject` was passed. The field is
      // named for the common case; the pair reads unambiguously together.
      mine: scopes.mine,
      // THE TENANT'S CAP, which combines with theirs by "stricter wins" and is
      // not theirs to change — shown so a narrowing they did not make is
      // attributable to somebody.
      tenant: scopes.tenant,
    });
  } catch (error) {
    return failed("could not read permissions", error);
  }
}

/**
 * Revoke one stored grant.
 *
 * BACK TO NO OPINION, NOT TO A DEFAULT. The store is copy-on-write: a row
 * exists only because somebody chose something, so removing it returns the
 * scope to "as the agent ships" rather than writing a default in its place.
 */
export async function POST(request: Request) {
  const who = await read();
  if (!who) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let policyId = "";
  try {
    const body = (await request.json()) as { policyId?: unknown };
    if (typeof body.policyId === "string") policyId = body.policyId;
  } catch {
    // Handled below.
  }
  if (!policyId) {
    return NextResponse.json({ error: "no policyId" }, { status: 400 });
  }

  const subject = `eu:${who.userId}`;

  try {
    // CHECKED AGAINST THEIR OWN ROWS FIRST. The service credential may name
    // any end user, so an id alone would otherwise be enough to revoke a
    // stranger's policy — the same reason `/api/approvals` proves ownership
    // before it decides anything.
    const scopes = await elan().autonomy.policies({ target: target(), user: subject });
    const theirs = scopes.mine.some((policy) => policy.policy_id === policyId);
    if (!theirs) {
      return NextResponse.json(
        { error: "no permission by that id for this identity" },
        { status: 404 },
      );
    }

    const policy = await elan().autonomy.reset(policyId, { user: subject });
    return NextResponse.json({ policy });
  } catch (error) {
    return failed("could not revoke", error);
  }
}
