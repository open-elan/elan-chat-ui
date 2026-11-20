"use client";

/**
 * "Connect GitHub" on a `connection` pause, and what the card says while the
 * person is signing in.
 *
 * THE WINDOW OPENS INSIDE THE CLICK (`openSignInWindow`), before the ticket is
 * fetched, and is pointed at the sign-in once it arrives. Its `opener` is cut
 * first, so the provider's page cannot reach back into this one.
 *
 * A LOADER FOR AS LONG AS THE WINDOW IS OPEN. Cutting the opener does not stop
 * THIS page reading `closed` on the window it opened, so the card can say
 * "waiting for you" while the window is up, "finishing up" for a moment after
 * it closes, and offer the button again only if the run did not carry on.
 *
 * NOTHING IS SENT BACK FROM HERE. The provider returns the person to the
 * platform, which resumes the run and closes the window; the whole pause card
 * goes when the resumed run's events arrive on the socket, as every answered
 * pause does.
 */

import { connectUrl, type ConnectionPause } from "elan-sdk";
import { ExternalLink, KeyRound, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { openSignInWindow } from "@/lib/popup";
import { freshTicket } from "@/lib/ticket";

/** How often the card looks at whether the sign-in window is still open. */
const WINDOW_POLL_MS = 500;
/** How long "finishing up" lasts once the window closes. The platform's page
 *  closes itself three seconds after the run is resumed, so a resuming run has
 *  usually arrived by then; a window closed early has not. */
const SETTLE_MS = 15_000;

type Step = "idle" | "opening" | "waiting" | "settling";

export function Connect({ connection }: { connection: ConnectionPause }) {
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState("");
  const tab = useRef<Window | null>(null);
  const name = connection.display_name;

  useEffect(() => {
    if (step !== "waiting") return;
    const timer = window.setInterval(() => {
      if (!tab.current || tab.current.closed) {
        window.clearInterval(timer);
        setStep("settling");
      }
    }, WINDOW_POLL_MS);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step !== "settling") return;
    const timer = window.setTimeout(() => {
      setNote("The sign-in window closed before the conversation carried on. "
        + "If you did not finish signing in, connect again.");
      setStep("idle");
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  async function open() {
    setNote("");
    setStep("opening");
    const opened = openSignInWindow();
    try {
      const link = connectUrl(connection, await freshTicket());
      if (opened) {
        opened.opener = null;
        opened.location.href = link;
        tab.current = opened;
        setStep("waiting");
      } else {
        // A blocked popup: the sign-in takes this tab instead.
        window.location.assign(link);
      }
    } catch (error) {
      opened?.close();
      setNote(error instanceof Error ? error.message : String(error));
      setStep("idle");
    }
  }

  if (step === "waiting" || step === "settling") {
    return (
      <div className="connecting" role="status">
        <LoaderCircle className="spin connecting-spinner" size={18} aria-hidden="true" />
        <div className="connecting-text">
          <strong>
            {step === "waiting" ? `Waiting for you to sign in to ${name}…` : "Finishing up…"}
          </strong>
          <span>
            {step === "waiting"
              ? "Finish in the window that opened. The conversation carries on here by itself."
              : `Connecting ${name} and picking the conversation back up.`}
          </span>
          {step === "waiting" && (
            <button type="button" className="connecting-show" onClick={() => tab.current?.focus()}>
              <ExternalLink size={14} aria-hidden="true" />
              Show the sign-in window
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pause-act">
        <button type="button" onClick={() => void open()} disabled={step === "opening"}>
          <KeyRound size={14} aria-hidden="true" />
          {step === "opening" ? "Opening…" : `Connect ${name}`}
        </button>
      </div>
      {note && <p className="pause-note">{note}</p>}
    </>
  );
}
