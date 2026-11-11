import { useState, type RefObject } from "react";
import { compareFeePolicies, impactDraft } from "../lib/rule-impact";
import { money, parseCents, type Agreement } from "../lib/model";
import { Button, Field, Notice } from "./ui";

export function RuleImpactReview({
  agreement,
  formRef,
  advance,
  revision,
  onChoose,
}: {
  agreement: Agreement;
  formRef: RefObject<HTMLFormElement | null>;
  advance: boolean;
  revision: number;
  onChoose: (policy: string) => void;
}) {
  const [gross, setGross] = useState("3000");
  const [fees, setFees] = useState("105.19");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    draftRevision: number;
    agreementRevision: number;
    choices: ReturnType<typeof compareFeePolicies>;
  } | null>(null);
  const current =
    result?.draftRevision === revision &&
    result.agreementRevision === agreement.revision
      ? result.choices
      : null;
  return (
    <details className="section rule-impact-review">
      <summary>Compare fee interpretations · impact on everyone</summary>
      <p>
        Where fees are unclear, compare these supported proposals using your
        draft shares and advance. Neither option is automatically fair or
        agreed.
      </p>
      <p className="muted">
        Illustration only, not an actual payment or fee quote. Existing
        recoupment is included. Dates, other costs and refund interpretations
        need separate clarification; this comparison does not resolve them.
      </p>
      <div className="form-grid">
        <Field label="Illustrative receipt (USD)">
          <input
            value={gross}
            inputMode="decimal"
            onChange={(event) => {
              setGross(event.target.value);
              setResult(null);
            }}
          />
        </Field>
        <Field label="Illustrative PayPal fee (USD)">
          <input
            value={fees}
            inputMode="decimal"
            onChange={(event) => {
              setFees(event.target.value);
              setResult(null);
            }}
          />
        </Field>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          try {
            if (!formRef.current) return;
            const draft = impactDraft(
              agreement,
              new FormData(formRef.current),
              advance,
            );
            setResult({
              draftRevision: revision,
              agreementRevision: agreement.revision,
              choices: compareFeePolicies(
                agreement,
                draft,
                parseCents(gross),
                parseCents(fees),
              ),
            });
            setError("");
          } catch (error) {
            setResult(null);
            setError((error as Error).message);
          }
        }}
      >
        Calculate both options
      </Button>
      {error && (
        <Notice warning>
          {error} Complete the draft terms before comparing.
        </Notice>
      )}
      {result && !current && (
        <p role="status">
          Draft or saved agreement changed. Calculate again to refresh the
          comparison.
        </p>
      )}
      {current && (
        <div className="impact-options">
          {current.map((choice) => {
            const preview = choice.preview;
            return (
              <section className="panel" key={choice.policy}>
                <h4>
                  {choice.policy === "BEFORE_SPLIT"
                    ? "Share processing fees"
                    : "Organizer covers processing fees"}
                </h4>
                <p>
                  {choice.policy === "BEFORE_SPLIT"
                    ? "Deduct fees before recoupment and splitting."
                    : "Recoup and split gross revenue, then deduct fees from the organizer."}
                </p>
                {preview && (
                  <>
                    <dl>
                      {preview.allocations.map((row) => (
                        <div className="impact-person" key={row.userId}>
                          <dt>
                            {
                              agreement.value.members.find(
                                (member) => member.userId === row.userId,
                              )?.displayName
                            }
                          </dt>
                          <dd>
                            <strong>{money(row.totalCents)}</strong>
                            <small>
                              Recoupment {money(row.recoupmentCents)} + share{" "}
                              {money(row.shareCents)} − direct fee{" "}
                              {money(row.feeCents)}
                            </small>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      Total allocated:{" "}
                      {money(
                        preview.allocations.reduce(
                          (sum, row) => sum + row.totalCents,
                          0,
                        ),
                      )}
                    </p>

                    {preview.requiresClarification && (
                      <Notice warning>
                        The advance has not been verified. This illustration is
                        not approval to pay.
                      </Notice>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onChoose(choice.policy)}
                    >
                      Use this fee proposal
                    </Button>
                  </>
                )}
                {choice.error && (
                  <Notice warning>
                    {choice.error}. This option cannot allocate the sample
                    payment.
                  </Notice>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="muted">
        Choosing an option only updates this draft. Save a new version and have
        everyone review it. Open questions remain unresolved until you
        explicitly address them.
      </p>
    </details>
  );
}
