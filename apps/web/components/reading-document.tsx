"use client";
import { useEffect, useRef, useState } from "react";
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

/**
 * Step 2: the checklist ticks while the real request runs. When reading can't run or finds
 * nothing usable, it hands over straight away (MANUAL) instead of showing a failure screen.
 */
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
  // One request per mount, even when StrictMode replays effects: the promise outlives the effect.
  const request = useRef<Promise<ReadingOutcome> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

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
    const settle = (outcome: ReadingOutcome) => {
      if (!alive) return;
      setPhase(
        outcome === ReadingOutcome.READY
          ? ReadingPhase.DONE
          : ReadingPhase.FALLBACK,
      );
      finish = setTimeout(() => done.current(outcome), READING_DONE_MS);
    };
    request.current.then(settle, () => settle(ReadingOutcome.MANUAL));
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

  return (
    <section className="reading-body" aria-labelledby="reading-title">
      <h1 id="reading-title">Reading your agreement</h1>
      <div className="reading-file-card">
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
        <p className="reading-file" title={fileName}>
          {fileName}
        </p>
      </div>
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
      <p className="reading-hint">Usually under a minute.</p>
    </section>
  );
}
