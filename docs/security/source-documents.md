# Source documents

PDF and DOCX files selected by an authorized agreement member are parsed locally. No automatic AI/OCR request occurs. Cloudflare rule extraction remains a separate explicit-consent action.

## Storage and access
- New successful PDF/DOCX uploads save the original bytes beside extracted text in the existing private SQLite database. Database backups now contain confidential original documents: protect storage and backups accordingly. This patch does not claim database-at-rest encryption.
- Each original is scoped to workspace, agreement and immutable document ID. Downloads require an authenticated session, workspace membership and agreement membership on every request. Upload membership is rechecked after asynchronous parsing.
- Downloads are attachments, never HTML/embedded previews; response headers disable caching and MIME sniffing. Filename is server-generated, not user-controlled.
- Previous uploads cannot recover lost originals. Text-only and legacy documents return a clear not-found result; the UI offers original download only when present.
- No automatic deletion policy is introduced. Retention follows existing agreement database retention. A future retention policy requires a product decision and migration.

## Parser boundaries
- 5 MiB upload maximum; canonical base64 and magic-byte checks; existing request/user rate limits.
- PDF: existing 20-page/40,000-character local extraction.
- DOCX: raw-text extraction using Mammoth 1.11.0, ZIP validation, at most 1,000 archive entries, 10 MiB per inflated entry and 32 MiB total actual inflated bytes; reject macro/ActiveX/embedded object packages. Never render generated HTML or execute document content. Formatting and tracked edits need manual comparison with original.
- Parsers run in separate credential-free subprocesses with 128 MiB JS heap, two concurrent jobs per format, 8-second timeout, bounded protocol output and suppressed source-bearing logs. This is resource isolation, not a claim of a kernel sandbox.

## OCR remains unavailable
No approved OCR provider or contract-sharing consent is configured. Image-only PDFs fail with instructions to paste text or supply a text-layer PDF. Do not upload private contracts to a new OCR service until provider, destination, data handling and user consent are established.
