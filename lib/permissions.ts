/**
 * What an agent may actually do, folded from the two halves that decide it.
 *
 * ── THE RESOLUTION ORDER, AS FAR AS A PAGE CAN KNOW IT ───────────────────────
 *
 * The platform decides a call like this:
 *
 *   1. a REFUSAL the manifest declares — a floor nothing stored reaches past
 *   2. the STRICTER of whichever scopes stored a policy, CLAMPED to the
 *      tool's declared ceiling
 *   3. the manifest's own rules, then the tool's tier, then the default tier
 *
 * A page can do steps 2 and 3 exactly. It CANNOT do step 1, because a refusal
 * is a condition on the arguments of a call that has not happened yet — so the
 * conditions are listed rather than evaluated, which is the honest rendering.
 *
 * ── AND ONLY STORED POLICIES ARE CLAMPED ─────────────────────────────────────
 *
 * The ceiling bounds what a ROW may grant; the manifest's own tier is not
 * clamped by it, "because it is already code". Applying the clamp to both
 * would under-report what the agent ships with.
 *
 * ── WHY THIS IS NOT IN THE COMPONENT ─────────────────────────────────────────
 *
 * It is a fold with no React in it. Keeping it here means it can be read,
 * tested and corrected without a renderer — and a mistake in it is the kind
 * that misleads somebody about a permission rather than looking broken.
 */

export type Outcome = "allow" | "ask" | "refuse";

/** t0 refuses, t1 asks, t2 allows. */
const BY_TIER: Record<string, Outcome> = { t0: "refuse", t1: "ask", t2: "allow" };

/** Stricter is lower. "Stricter wins" is a min over this. */
const STRICTNESS: Record<Outcome, number> = { refuse: 0, ask: 1, allow: 2 };

export interface StoredPolicy {
  policy_id: string;
  scope: string;
  tool: string;
  policy: { tier: string | null; labels: string[]; rules: unknown[] };
}

export interface Declared {
  tier: string | null;
  ceiling: string | null;
  labels: string[];
  refuses: (Record<string, unknown> | null)[];
  negotiable_rules: number;
}

export interface Resolved {
  tool: string;
  labels: string[];
  outcome: Outcome;
  /** Who the outcome came from, for the sentence beside it. */
  source: "agent" | "you" | "tenant";
  /** A stored row of the caller's own, so it can be revoked. */
  mine: StoredPolicy | null;
  /** True when a stored grant was held DOWN by the author's ceiling — the one
   *  state a permissions page exists to explain. */
  capped: boolean;
  ceiling: string | null;
  refuses: (Record<string, unknown> | null)[];
  negotiable_rules: number;
}

function clamp(outcome: Outcome, ceiling: string | null): Outcome {
  if (!ceiling) return outcome;
  const limit = BY_TIER[ceiling];
  if (!limit) return outcome;
  return STRICTNESS[outcome] <= STRICTNESS[limit] ? outcome : limit;
}

function tierOf(policy: StoredPolicy | undefined): Outcome | null {
  const tier = policy?.policy?.tier;
  return tier ? (BY_TIER[tier] ?? null) : null;
}

/**
 * One row per tool the agent DECLARES, which is the set that can be governed.
 *
 * Driven by the declaration rather than by the stored rows: a tool nobody has
 * an opinion about still belongs on this page, and saying "as the agent ships"
 * is the whole point — AN ABSENT POLICY HAS NO OPINION, never a default one.
 */
export function resolvePermissions(
  declared: Record<string, Declared> | null,
  mine: readonly StoredPolicy[],
  tenant: readonly StoredPolicy[],
  defaultTier: string,
): Resolved[] {
  if (!declared) return [];

  const byTool = (rows: readonly StoredPolicy[]) =>
    new Map(rows.map((row) => [row.tool, row]));
  const ours = byTool(mine);
  const theirs = byTool(tenant);

  return Object.entries(declared)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, policy]) => {
      const shipped = clamp(
        BY_TIER[policy.tier ?? defaultTier] ?? "ask",
        // NOT CLAMPED: the manifest's own tier is code, and the ceiling bounds
        // what a stored ROW may grant. Passing null keeps that explicit.
        null,
      );

      const stored: { outcome: Outcome; source: "you" | "tenant" }[] = [];
      const own = tierOf(ours.get(tool));
      if (own !== null) stored.push({ outcome: own, source: "you" });
      const cap = tierOf(theirs.get(tool));
      if (cap !== null) stored.push({ outcome: cap, source: "tenant" });

      let outcome = shipped;
      let source: Resolved["source"] = "agent";
      let capped = false;

      if (stored.length > 0) {
        // THE STRICTER WINS, and a tie goes to the user — when both agree it
        // is their own policy doing the work.
        const won = stored.reduce((a, b) =>
          STRICTNESS[b.outcome] < STRICTNESS[a.outcome] ? b : a,
        );
        const held = clamp(won.outcome, policy.ceiling);
        capped = held !== won.outcome;
        outcome = held;
        source = won.source;
      }

      return {
        tool,
        labels: policy.labels ?? [],
        outcome,
        source,
        mine: ours.get(tool) ?? null,
        capped,
        ceiling: policy.ceiling,
        refuses: policy.refuses ?? [],
        negotiable_rules: policy.negotiable_rules ?? 0,
      };
    });
}

/** `{field, op, value}` as a sentence somebody can act on. */
export function refusalText(when: Record<string, unknown> | null): string {
  if (!when) return "every call";
  const { field, op, value } = when as { field?: string; op?: string; value?: unknown };
  if (!field || !op) return "a condition the agent declares";
  return `${field} ${op} ${typeof value === "string" ? `"${value}"` : String(value)}`;
}
