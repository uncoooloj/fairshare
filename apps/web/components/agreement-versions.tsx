import {
  changedRuleFields,
  changedShares,
  type ComparisonField,
} from "../lib/version-comparison";
import type { Agreement, Version } from "../lib/model";
import { money, title } from "../lib/model";
import { versionSummary } from "../lib/version-summary";
import styles from "./agreement-versions.module.css";
function RuleSummary({
  agreement,
  version,
  changed = [],
}: {
  agreement: Agreement;
  version: Version;
  changed?: ComparisonField[];
}) {
  const rules = version.rules;
  const name = (id: string) =>
    agreement.value.members.find((member) => member.userId === id)
      ?.displayName ?? "Former participant";
  const label = (field: ComparisonField, text: string) => (
    <dt className={changed.includes(field) ? styles.changed : undefined}>
      {text}
      {changed.includes(field) && (
        <span className={styles.changeBadge}>Changed</span>
      )}
    </dt>
  );
  return (
    <dl className={styles.rules}>
      {label("shares", "Revenue split")}
      <dd>
        {rules.shares.map((share) => (
          <div key={share.userId}>
            {name(share.userId)} · {share.basisPoints / 100}%
          </div>
        ))}
      </dd>
      {label("fees", "Processing fees")}
      <dd>
        {rules.feePolicy === "BEFORE_SPLIT"
          ? "Deducted before the split"
          : `Covered by ${rules.feeBearerId ? name(rules.feeBearerId) : "the designated fee bearer"}`}
      </dd>
      {label("advance", "Recoupment")}
      <dd>
        {rules.advance
          ? `${money(rules.advance.amountCents)} to ${name(rules.advance.recipientId)} · ${rules.advance.verified ? "verified advance" : "unverified advance"}`
          : "No advance"}
        {rules.advance && (
          <div className="muted">
            {rules.advance.source.clause}: {rules.advance.source.excerpt}
          </div>
        )}
      </dd>
      {label("source", "Source clause")}
      <dd>{rules.source.clause}</dd>

      <dt>Interpretation</dt>
      <dd>
        {rules.source.origin === "HUMAN_PROPOSAL"
          ? "Edited by a person"
          : "Read from the agreement"}
      </dd>
      {label("source", "Source wording")}
      <dd>{rules.source.excerpt}</dd>
      {label("questions", "Clarifications")}
      <dd>
        {rules.unresolvedQuestions.length
          ? rules.unresolvedQuestions.join(" · ")
          : "None outstanding"}
      </dd>
    </dl>
  );
}
export function AgreementVersions({ agreement }: { agreement: Agreement }) {
  const versions = agreement.value.versions;
  const latest = versions.at(-1);
  if (!latest) return null;
  return (
    <section
      className={`section ${styles.timeline}`}
      aria-label="Agreement versions"
    >
      <div className={styles.heading}>
        <h3>Versions</h3>
        <span className="muted">
          {versions.length} {versions.length === 1 ? "version" : "versions"}
        </span>
      </div>
      {[...versions].reverse().map((version) => {
        const state = versionSummary(agreement, version);
        const changed = changedRuleFields(version.rules, latest.rules);
        const shareChanges = changedShares(version.rules, latest.rules);
        return (
          <article key={version.id} className={styles.version}>
            <div className={styles.heading}>
              <strong>
                Version {version.id}
                {state.latest ? " · latest" : ""}
              </strong>
              <span>{state.active ? "Active" : title(version.status)}</span>
            </div>
            <p className="muted">{state.description}</p>
            <small>
              {state.approved} of {state.total} people approved this version
            </small>
            {!state.latest && (
              <details className={styles.compare}>
                <summary>Compare with v{latest.id}</summary>
                <p className={styles.changeSummary}>
                  {changed.length
                    ? `${changed.length} ${changed.length === 1 ? "section changed" : "sections changed"}`
                    : "No rule changes"}
                </p>
                {shareChanges.length > 0 && (
                  <ul
                    aria-label="Share changes"
                    className={styles.shareChanges}
                  >
                    {shareChanges.map((change) => (
                      <li key={change.userId}>
                        {agreement.value.members.find(
                          (member) => member.userId === change.userId,
                        )?.displayName ?? "Former participant"}
                        :{" "}
                        {change.before === undefined
                          ? "Not included"
                          : `${change.before / 100}%`}{" "}
                        →{" "}
                        {change.after === undefined
                          ? "Removed"
                          : `${change.after / 100}%`}
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.columns}>
                  <div>
                    <h4>Version {version.id}</h4>
                    <RuleSummary
                      agreement={agreement}
                      version={version}
                      changed={changed}
                    />
                  </div>
                  <div>
                    <h4>Version {latest.id} · latest</h4>
                    <RuleSummary
                      agreement={agreement}
                      version={latest}
                      changed={changed}
                    />
                  </div>
                </div>
                <p className="muted">
                  These changes apply only after everyone approves the new
                  version. Earlier payments keep their original rules.
                </p>
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}
