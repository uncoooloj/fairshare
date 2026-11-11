"use client";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./logo-mark";
import {
  nextActiveStep,
  READING_STEPS,
  readingAnnouncement,
  ReadingOutcome,
  ReadingPhase,
  readingStepStatus,
  ReadingStepStatus,
} from "../lib/reading";

export { ReadingOutcome } from "../lib/reading";

export const READING_STEP_MS = 2200;
export const READING_DONE_MS = 700;

export function ReadingDocument({
  fileName,
  run,
  onDone,
}: {
  fileName: string;
  run: () => Promise<ReadingOutcome>;
  onDone(outcome: ReadingOutcome): void;
}) {
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState(ReadingPhase.RUNNING);
  const [error, setError] = useState("");
  // One request per mount, even when StrictMode replays effects: the promise outlives the effect.
  const request = useRef<Promise<ReadingOutcome> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const continueButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request.current) {
      try {
        request.current = Promise.resolve(run());
      } catch (e) {
        request.current = Promise.reject(e);
      }
    }
    let alive = true;
    let finish: ReturnType<typeof setTimeout> | undefined;
    request.current.then(
      (outcome) => {
        if (!alive) return;
        if (outcome === ReadingOutcome.READY) {
          setPhase(ReadingPhase.DONE);
          finish = setTimeout(
            () => done.current(ReadingOutcome.READY),
            READING_DONE_MS,
          );
        } else setPhase(ReadingPhase.FALLBACK);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(
          e instanceof Error && e.message
            ? e.message
            : "Something went wrong while reading.",
        );
        setPhase(ReadingPhase.FALLBACK);
      },
    );
    return () => {
      alive = false;
      if (finish) clearTimeout(finish);
    };
    // run is intentionally read once; a new request needs a new mount (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== ReadingPhase.RUNNING) return;
    const timer = setInterval(
      () => setActive((step) => nextActiveStep(step)),
      READING_STEP_MS,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === ReadingPhase.FALLBACK) continueButton.current?.focus();
  }, [phase]);

  const fallback = phase === ReadingPhase.FALLBACK;
  return (
    <main className="reading-document" aria-labelledby="reading-title">
      <div className="reading-brand">
        <LogoMark />
        Fairshare
      </div>
      <div className="reading-body">
        <span className="reading-file-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
            <path
              d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M14 3v5h5M9 13h6M9 17h4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 id="reading-title">
          {fallback ? "Add the terms yourself" : "Reading your agreement"}
        </h1>
        <p className="reading-file" title={fileName}>
          {fileName}
        </p>
        <ol className="reading-steps" aria-label="Reading progress">
          {READING_STEPS.map((label, index) => {
            const status = readingStepStatus(index, active, phase);
            return (
              <li
                key={label}
                className={`reading-step ${status}`}
                aria-current={
                  status === ReadingStepStatus.ACTIVE ? "step" : undefined
                }
              >
                <span className="reading-step-mark" aria-hidden="true">
                  {status === ReadingStepStatus.DONE && (
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                      <path
                        d="m3.5 8.5 3 3 6-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span>{label}</span>
                <span className="visually-hidden">
                  {status === ReadingStepStatus.DONE
                    ? " (done)"
                    : status === ReadingStepStatus.ACTIVE
                      ? " (in progress)"
                      : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="visually-hidden" role="status" aria-live="polite">
          {readingAnnouncement(active, phase)}
        </p>
        {fallback ? (
          <div className="reading-fallback">
            <p>We couldn&apos;t read every term. You can add them yourself.</p>
            {error && <p className="reading-error">{error}</p>}
            <button
              ref={continueButton}
              type="button"
              className="button primary"
              onClick={() => onDone(ReadingOutcome.MANUAL)}
            >
              Continue to rules
            </button>
          </div>
        ) : (
          <p className="reading-hint">
            Usually under a minute. Keep this tab open.
          </p>
        )}
      </div>
    </main>
  );
}
