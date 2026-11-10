# Agreement PDF ingestion

Authenticated collaboration members may upload a **text-based PDF** via:

`POST /api/workspaces/:workspaceId/collaborations/:collaborationId/documents/pdf`

Body `{ "mimeType": "application/pdf", "base64": "..." }`. It is an API transport envelope, not a data URL. Existing plain-text document endpoint remains available.

## Bounds and handling

- 5 MiB decoded file limit and bounded HTTP request body.
- Strict base64 and PDF header checks; malformed, encrypted/password-required and unparseable PDFs fail with safe error codes.
- 20 pages and 40,000 extracted UTF-16 code units maximum.
- Separate child process, 128 MiB V8 heap, 8-second timeout, bounded output, max two parsers per server process.
- PDF parsing is local. No uploaded source is automatically sent to Cloudflare. That remains a separate explicit-consent action.
- Child receives only NODE_ENV, no application secrets. No shell commands are constructed from document content or filenames. PDF JavaScript evaluation, XFA, remote worker fetching and font rendering are disabled.
- Child process limits are defense in depth, **not an OS security sandbox**. A production multi-tenant service should additionally use an isolated parsing container with network denied and filesystem restricted, plus host-level memory/process limits.
- Parser stdout is a private IPC payload, not logged. Stderr is drained and discarded, never exposed to clients. API returns only safe error codes/messages.
- New successful PDF uploads retain the original bytes with extracted text, original-file SHA-256, extraction engine version and page offset ranges in the private SQLite database. Authorized agreement members can download the original as an attachment. Text-only and legacy uploads retain extracted text only; see security/source-documents.md.
- PDF text layer reading order may differ from visual order, especially multi-column documents, tables, ligatures, invisible text and unusual fonts. The UI must show the extracted text for review. Exact AI offsets reference this text, **not** pixels or raw PDF byte positions. A matching quote does not prove contract semantics.
- Scanned/image-only or empty PDFs fail with PDF_NO_EXTRACTABLE_TEXT unless the user explicitly selects locally enabled OCR. Local OCR is off by default and has separate five-page limits. Text-layer parsing never silently falls back to OCR; see LOCAL-OCR.md.

## Provenance

Stored `sourceHash` hashes exact persisted extracted text. `provenance.sourceFileSha256` hashes original PDF bytes. `pages` contains `{page,start,end}` for each page, in UTF-16 code units. Citation offsets from AI extraction refer to this same immutable string. Uploading another document creates a new source identity, never silently replaces prior clauses.

## Verification

Tests cover multipage text/hash/offset stability, malformed/base64/magic/oversize input, blank text layers, page/text caps, timeouts, parser concurrency, authenticated API ingestion and absence of automatic AI processing. Synthetic fixtures only; no private contracts used.
