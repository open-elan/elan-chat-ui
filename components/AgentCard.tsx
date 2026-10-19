"use client";

/**
 * What this agent is, what it costs and what it can reach.
 *
 * ── EVERY FIGURE CARRIES ITS UNIT, AND THEY ARE NOT THE SAME UNIT ────────────
 *
 * `deposit_micros` is MICRO-USD; the token costs are US CENTS PER MILLION
 * TOKENS, carried unconverted all the way from the manifest because converting
 * twice is how a price gets shown ten thousand times out. They are converted
 * here, once, at the point they are written — with the unit beside them.
 *
 * ── ABSENT IS "NOT RECORDED", NEVER ZERO ─────────────────────────────────────
 *
 * The recorded manifest is an allow-list, and a target keeps the facts it had
 * until its image actually MOVES — so an agent can be redeployed and still
 * carry what was recorded the last time it changed. Rendering a missing price
 * as free would be a wrong answer where none was available.
 */

import { useEffect, useState } from "react";
import { dollars } from "elan-sdk";
import type { ManifestFacts } from "elan-sdk";

interface Answer {
  slug: string;
  version: string;
  workload: string;
  manifest: ManifestFacts;
}

/**
 * A micro-USD amount, exactly, with the noise trimmed.
 *
 * `dollars()` IS INTEGER ARITHMETIC TO A STRING and always gives six places,
 * which is right for a statement line and heavy for a card: a 3,000 micro-USD
 * reservation reads `$0.003000`. `formatUsd` is the other extreme and would
 * render it `$0.00` — hiding the only figure on the row. So the exact value is
 * kept and only trailing zeros go, never a significant digit, with two places
 * as the floor so a round amount still looks like money.
 */
function exactUsd(micros: number): string {
  const text = dollars(micros);
  if (!text.includes(".")) return `$${text}`;
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `$${whole}.${trimmed.padEnd(2, "0")}`;
}

/** US cents per million tokens -> "$0.40 / M". */
function perMillion(cents: number | undefined): string | null {
  if (cents === undefined || cents === null) return null;
  return `$${(cents / 100).toFixed(2)} / M`;
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AgentCard() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await fetch("/api/agent");
        const body = (await response.json()) as Answer & { error?: string };
        if (!current) return;
        if (!response.ok) {
          setFailure(body.error || `could not read the agent (${response.status})`);
          return;
        }
        setAnswer(body);
      } catch (thrown) {
        if (current) setFailure(thrown instanceof Error ? thrown.message : String(thrown));
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  if (failure) return <p className="card-note">{failure}</p>;
  if (!answer) return null;

  const m = answer.manifest;
  const billing = m.billing ?? {};
  const limits = m.limits ?? {};
  const recorded = Object.keys(m).length > 0;

  return (
    <details className="card">
      <summary>
        About this agent
        <span className="card-version"> · v{answer.version}</span>
      </summary>

      {!recorded ? (
        <p className="card-note">
          Nothing was recorded for this target. A deploy only rewrites these
          when the target&apos;s image actually moves, so redeploy it after a
          change to see them.
        </p>
      ) : (
        <>
          {m.description && <p className="card-blurb">{m.description}</p>}

          <dl className="facts">
            <Fact label="Name" value={m.display_name ?? answer.slug} />
            <Fact label="Kind" value={m.kind ?? null} />
            <Fact label="Model" value={m.model ?? (m.models ?? [])[0] ?? null} />
            {/* THE POD, WHICH IS NOT ALWAYS ITSELF. A grouped agent restarts
                and scales with its neighbours, so a cold start can be caused
                by a target nobody in this conversation mentioned. */}
            <Fact
              label="Runs in"
              value={
                answer.workload && answer.workload !== answer.slug
                  ? `${answer.workload} (shared)`
                  : "its own pod"
              }
            />
            <Fact
              label="Asks by default"
              value={
                m.default_tier === "t0" ? "refuses everything that acts"
                : m.default_tier === "t2" ? "acts without asking"
                : m.default_tier === "t1" ? "asks before it acts"
                : null
              }
            />
            {/* MICRO-USD, SHOWN EXACTLY. A per-run reservation is sub-cent, so
                two reservations differing threefold both round to $0.00. */}
            <Fact
              label="Reserved per run"
              value={
                billing.deposit_micros === undefined
                  ? null
                  : exactUsd(billing.deposit_micros)
              }
            />
            <Fact label="Input tokens" value={perMillion(billing.input_token_cost)} />
            <Fact label="Cached input" value={perMillion(billing.cached_input_token_cost)} />
            <Fact label="Output tokens" value={perMillion(billing.output_token_cost)} />
            <Fact
              label="Model calls"
              value={limits.max_llm_calls ? `up to ${limits.max_llm_calls} per run` : null}
            />
            <Fact
              label="Time limit"
              value={limits.timeout_s ? `${limits.timeout_s}s per run` : null}
            />
          </dl>

          {(m.tools ?? []).length > 0 && (
            <p className="card-note">
              Reaches{" "}
              {(m.tools ?? []).map((tool, at) => (
                <span key={tool.ref}>
                  {at > 0 && ", "}
                  <code>{tool.ref}</code> ({tool.kind})
                </span>
              ))}
              .
            </p>
          )}

          {m.acting_tools && m.acting_tools.length > 0 && (
            <p className="card-note">
              {m.acting_tools.length} tool
              {m.acting_tools.length === 1 ? "" : "s"} can act — the rest only
              read, and were never gated. See Action settings.
            </p>
          )}
        </>
      )}
    </details>
  );
}
