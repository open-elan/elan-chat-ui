"use client";

/**
 * What this end user has left, and what they have spent.
 *
 * ── WHY THE HELD AMOUNT IS SHOWN AND NOT HIDDEN ──────────────────────────────
 *
 * A prepaid run RESERVES before it spends: the plugin opens a hold at the start
 * of a turn and settles it at the end, so for the length of a run the balance
 * is unchanged and the available figure is lower. Showing only "available"
 * makes that read as money vanishing and coming back.
 *
 * It also makes the refresh below honest. This refetches when a run reaches a
 * terminal event, which can land while the settle is still in flight — so a
 * figure read in that instant may still carry the hold. With `held` on screen
 * that is a visible, explainable state rather than a wrong number.
 *
 * ── AND IT ONLY READS ───────────────────────────────────────────────────────
 *
 * `/api/wallet` goes through `elan.wallets`, which issues no non-GET. Topping
 * up lives on `elan.credit` and is an administrative act on the tenant's own
 * customers — not something a chat UI does for whoever is looking at it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentEvents } from "elan-sdk/react";
import { dollars, formatUsd, type StatementEntry, type Wallet as WalletRow } from "elan-sdk";

interface Answer {
  wallet: WalletRow | null;
  entries: StatementEntry[];
  total: number;
  unavailable?: string;
}

/**
 * A statement line, EXACTLY — all six places, not rounded to cents.
 *
 * THE LEDGER STORES MICRO-USD AND A PER-RUN SETTLE IS SUB-CENT. Measured on
 * this wallet: `-7749`, `-5409`, `-2374`, `-2682` micro-USD. Rounded to cents
 * those read `-$0.01`, `-$0.01`, `-$0.00`, `-$0.00` — four rows that differ by
 * 3x, shown as two values. So the statement shows what is stored.
 *
 * `dollars()` RATHER THAN A DIVISION, because it is integer arithmetic to a
 * string. `0.1 + 0.2` is not `0.3` in binary floating point, and a currency
 * figure a thousandth of a cent out is one nobody can reconcile — which is why
 * the SDK has this function at all and why `micros()` refuses a float.
 */
function exact(micros: number): string {
  const text = dollars(micros);
  return text.startsWith("-") ? `-$${text.slice(1)}` : `+$${text}`;
}

function when(stamp: string): string {
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Wallet({ sessionId }: { sessionId: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState("");
  const { events } = useAgentEvents(sessionId);

  // A RUN THAT ENDED MAY HAVE SPENT SOMETHING. Counting terminal events rather
  // than watching the array is what keeps this to one refetch per run instead
  // of one per frame — `events` grows on every `typing`.
  const settled = useMemo(
    () => events.filter((e) => e.kind === "finished" || e.kind === "error").length,
    [events],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet");
      const body = (await response.json()) as Answer & { error?: string };
      if (!response.ok) {
        setFailed(body.error || `could not read the wallet (${response.status})`);
        return;
      }
      setFailed("");
      setAnswer(body);
    } catch (thrown) {
      setFailed(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, settled]);

  if (failed) return <p className="purse-note">{failed}</p>;
  if (!answer) return null;

  if (answer.unavailable) {
    return <p className="purse-note">{answer.unavailable}</p>;
  }

  const wallet = answer.wallet;
  if (!wallet) {
    // THE STATE EVERY DEMO STARTS IN. A wallet exists only because somebody
    // opened one, so this names the command rather than looking broken.
    return (
      <div className="purse">
        <span className="purse-label">Credits</span>
        <p className="purse-note">
          No wallet for this user. Open one with{" "}
          <code>elan wallet new &lt;id&gt;</code> and credit it; until then runs
          are charged to the tenant.
        </p>
      </div>
    );
  }

  const frozen = wallet.status !== "active";

  return (
    <div className="purse">
      <span className="purse-label">Credits</span>
      <p className="purse-amount">{formatUsd(wallet.available_micros)}</p>

      {/* ONLY WHEN THERE IS SOME, because a permanent "$0.00 held" is noise —
          and when it is not zero it is the whole explanation for the gap. */}
      {wallet.held_micros > 0 && (
        <p className="purse-held">
          {formatUsd(wallet.held_micros)} reserved by a run in flight
        </p>
      )}

      {frozen && (
        // A FROZEN WALLET REFUSES RUNS, and the refusal arrives as a 402 on the
        // next message. Saying so here is the difference between "it stopped
        // working" and "somebody froze this".
        <p className="purse-frozen">
          This wallet is {wallet.status} — runs will be refused until it is
          active again.
        </p>
      )}

      {answer.entries.length > 0 && (
        <details className="purse-statement">
          <summary>
            Statement
            {answer.total > answer.entries.length && (
              <span className="purse-more">
                {" "}
                · {answer.entries.length} of {answer.total}
              </span>
            )}
          </summary>
          <ul>
            {answer.entries.map((entry) => (
              <li key={entry.transaction_id}>
                <span
                  className={
                    entry.amount_micros < 0 ? "purse-out" : "purse-in"
                  }
                >
                  {exact(entry.amount_micros)}
                </span>
                <span className="purse-kind">{entry.kind}</span>
                {/* `ref` IS NULLABLE — a credit with no reference stores NULL,
                    which the type used to deny and a renderer has to branch on. */}
                {entry.ref && <span className="purse-ref">{entry.ref}</span>}
                <span className="purse-when">{when(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
