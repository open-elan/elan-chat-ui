/**
 * Claim a demo identity. THE ONE ROUTE TO REPLACE IN A REAL APP.
 *
 * There is no password here and no provider — see `lib/identity.ts`. Swap this
 * for your own sign-in and nothing else in the app changes, because every
 * other route asks `identity.read()` rather than trusting its caller.
 */

import { NextResponse } from "next/server";

import { cookieFor, read } from "@/lib/identity";

export async function GET() {
  const who = await read();
  return NextResponse.json(who ?? { userId: "", label: "" });
}

export async function POST(request: Request) {
  let label = "";
  try {
    const body = (await request.json()) as { label?: unknown };
    if (typeof body.label === "string") label = body.label.trim().slice(0, 40);
  } catch {
    // An empty or unparseable body just means "no name given".
  }
  if (!label) {
    return NextResponse.json({ error: "give yourself a name" }, { status: 400 });
  }

  const cookie = cookieFor(label);
  // SET ON THE RESPONSE WE RETURN. A cookie set on some other object is
  // dropped silently by several frameworks, and the symptom is a sign-in that
  // succeeds and then 401s on everything with nothing connecting the two.
  const answer = NextResponse.json({ label });
  answer.cookies.set(cookie.name, cookie.value, cookie.options);
  return answer;
}
