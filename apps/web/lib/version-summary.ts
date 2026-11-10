import type { Agreement, Version } from './model';
export function versionSummary(agreement: Agreement, version: Version) {
  const approved = agreement.value.members.filter(member => Object.hasOwn(version.approvals, member.userId)).length;
  const total = agreement.value.members.length;
  const active = agreement.value.activeVersionId === version.id;
  return { approved, total, active, latest: agreement.value.versions.at(-1)?.id === version.id,
    description: active ? 'Active rules for incoming payments.' : version.status === 'AWAITING_APPROVAL' ? 'Everyone reviews this version before the organizer can activate it.' : version.status === 'APPROVED' ? 'Approved by everyone. Not active until the organizer activates it.' : version.status === 'DRAFT' ? 'Draft only. Not used to split payments.' : 'Historical version. Past allocations keep their original rules.' };
}
