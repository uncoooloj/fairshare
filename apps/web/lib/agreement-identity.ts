export type AgreementIdentity = { workspaceId: string; id: string };

export function agreementIdentityKey({ workspaceId, id }: AgreementIdentity) {
  return JSON.stringify([workspaceId, id]);
}

export function findAgreementByIdentity<T extends AgreementIdentity>(
  agreements: readonly T[],
  key: string,
) {
  return agreements.find(
    (agreement) => agreementIdentityKey(agreement) === key,
  );
}
