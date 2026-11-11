"use client";
import {
  blockingReasons,
  summarySentences,
  type AgreementAnswers,
} from "../lib/rules-answers";

/** Step 6: the agreement in sentences, anything still blocking it, and the one safety line. */
export function WizardSendStep({
  answers,
  error,
}: {
  answers: AgreementAnswers;
  error?: string;
}) {
  const lines = summarySentences(answers);
  const reasons = blockingReasons(answers);
  return (
    <section className="wiz-step wiz-send" aria-labelledby="wiz-step-title">
      <h1 id="wiz-step-title" tabIndex={-1}>
        Ready to send
      </h1>
      <ul className="wiz-summary">
        {lines.map((line, index) => (
          <li key={line} className={index === 0 ? "wiz-summary-title" : ""}>
            {line}
          </li>
        ))}
      </ul>
      {reasons.length > 0 && (
        <div className="wiz-blocking" role="status">
          <p>Before you send:</p>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="wiz-lede">
        Nothing is paid until everyone approves. You can still change things if
        someone asks.
      </p>
      {error && (
        <p className="wiz-error wiz-error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
