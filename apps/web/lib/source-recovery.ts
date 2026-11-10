/** Existing proposals stay pinned to their immutable source, never a newer upload. */
export async function recoverSourceDocument(
  agreementPath: string,
  versionDocumentId: string | undefined,
  request: (path: string) => Promise<any>,
) {
  let documentId = versionDocumentId;
  if (!documentId) {
    const history = await request(`${agreementPath}/documents`);
    documentId = history.documents[0]?.documentId;
  }
  if (!documentId) return null;
  return request(`${agreementPath}/documents/${encodeURIComponent(documentId)}`);
}
