# Recovering an uploaded agreement after reload

`GET /api/workspaces/:workspaceId/collaborations/:collaborationId/documents`

Requires a live authenticated session, workspace membership and agreement membership. Response:

```
{ documents: [{ documentId, revision, sourceHash, hasExtraction, provenance }], nextCursor: string | null }
```

Newest upload first, at most 100 results. Pass `?before=<nextCursor>` for older results. Treat the cursor as opaque; it conveys neither access nor document identity. Pick `documents[0]` to recover the latest uploaded draft before any rule proposal exists. Then GET `/documents/:documentId` to recover exact source text and saved extraction. The single-document response reports `hasOriginal`; when true, authorized members can request `/documents/:documentId/original` as a private attachment. No text or extracted facts appear in the list. Empty history returns an empty array, not a synthetic agreement. PDF provenance includes original-file hash and exact text-layer page ranges; plain text marks UTF16 code units. Selecting a historical source must not silently change the source of an existing proposed version.

## Targeted security review (not a full security certification)

Fixed: extraction revalidated membership before outbound processing but not after the asynchronous provider call. A revoked session could receive and persist the completed extraction. The route now checks session/workspace/agreement membership again before any persistence or response; regression test revokes the session during a deferred extraction.

Verified via routes/tests and code inspection:

- Source reads/list use both tenant and agreement predicates; workspace members outside an agreement cannot inspect it.
- Missing authentication, foreign tenants, foreign agreement IDs and guessed document IDs do not return confidential text.
- List bounded to 100 metadata records; cursor is validated and cannot replace the scoped predicates.
- AI processing still requires explicit consent, which discloses Cloudflare as the primary provider and the configured optional Anthropic fallback. Source hash/document/revision bind returned results to the immutable upload.
- Extraction treats document text as untrusted data, no tool execution or arbitrary URL fetching. Config constrains provider URL; redirects disabled. Provider JSON has byte/schema limits and exact quoted-source validation. Output cannot activate agreement terms or issue payments.
- PDF and DOCX parsers run bounded child processes without provider secrets. OCR has no remote provider; when host-enabled, textless PDFs automatically fall back once to local OCR with its own limits; see LOCAL-OCR.md. Strong OS-level isolation remains a production hardening item.

Residual: citation correctness is not semantic correctness. Malicious or contradictory clauses may still produce misleading source-grounded observations; all proposed rules need human review and unanimous version approval. Rate limits are per process; distributed abuse protection is not implemented. This patch does not add antivirus, encryption-at-rest, retention deletion, or legal signature semantics.
