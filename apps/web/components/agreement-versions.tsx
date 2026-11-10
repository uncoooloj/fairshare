import type { Agreement, Version } from '../lib/model';
import { money, title } from '../lib/model';
import { versionSummary } from '../lib/version-summary';
import styles from './agreement-versions.module.css';
function RuleSummary({agreement,version}:{agreement:Agreement;version:Version}) {
  const rules=version.rules;
  const name=(id:string)=>agreement.value.members.find(member=>member.userId===id)?.displayName ?? 'Former participant';
  return <dl className={styles.rules}>
    <dt>Revenue split</dt><dd>{rules.shares.map(share=><div key={share.userId}>{name(share.userId)} · {share.basisPoints/100}%</div>)}</dd>
    <dt>Processing fees</dt><dd>{rules.feePolicy==='BEFORE_SPLIT'?'Deducted before the split':`Covered by ${rules.feeBearerId ? name(rules.feeBearerId) : 'the designated fee bearer'}`}</dd>
    <dt>Recoupment</dt><dd>{rules.advance?`${money(rules.advance.amountCents)} to ${name(rules.advance.recipientId)} · ${rules.advance.verified?'verified advance':'unverified advance'}`:'No advance'}</dd>
    <dt>Source clause</dt><dd>{rules.source.clause}</dd>
    <dt>Source wording</dt><dd>{rules.source.excerpt}</dd>
    <dt>Clarifications</dt><dd>{rules.unresolvedQuestions.length?rules.unresolvedQuestions.join(' · '):'None outstanding'}</dd>
  </dl>;
}
export function AgreementVersions({agreement}:{agreement:Agreement}) {
  const versions=agreement.value.versions;
  const latest=versions.at(-1);
  if(!latest)return null;
  return <section className={`section ${styles.timeline}`} aria-label="Agreement versions">
    <div className={styles.heading}><h3>Versions</h3><span className="muted">{versions.length} {versions.length===1?'version':'versions'}</span></div>
    {[...versions].reverse().map(version=>{
      const state=versionSummary(agreement,version);
      return <article key={version.id} className={styles.version}>
        <div className={styles.heading}><strong>Version {version.id}{state.latest?' · latest':''}</strong><span>{state.active?'Active':title(version.status)}</span></div>
        <p className="muted">{state.description}</p><small>{state.approved} of {state.total} people approved this version</small>
        {!state.latest && <details className={styles.compare}><summary>Compare with v{latest.id}</summary><div className={styles.columns}><div><h4>Version {version.id}</h4><RuleSummary agreement={agreement} version={version}/></div><div><h4>Version {latest.id} · latest</h4><RuleSummary agreement={agreement} version={latest}/></div></div><p className="muted">Read-only comparison. It does not change approvals, active rules or historical allocations.</p></details>}
      </article>;
    })}
  </section>;
}
