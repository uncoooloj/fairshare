# Local scanned-PDF OCR

OCR runs entirely on the API host using Poppler and Tesseract. No document is uploaded to an OCR provider. It is separate from the opt-in Cloudflare rule interpretation step.

## Enable

Install maintained `poppler-utils` and `tesseract-ocr` with English language data from the host OS's official package repository. On macOS use trusted Homebrew `poppler` and `tesseract` packages. The process searches `/usr/local/bin`, `/usr/bin`, `/bin` and `/opt/homebrew/bin`; no application credentials are passed to these subprocesses. Set `LOCAL_OCR_ENABLED=true` and restart the API. Startup fails if required tools cannot run. Default is off; the app offers paste-text fallback when unavailable.

For each scanned PDF, the user must select **Use local OCR** before uploading. Text-layer PDF processing never silently falls back to OCR. Uploaded originals remain authenticated attachments, not public links. OCR output is labelled and requires checking every amount, percentage and name against the original before proposing rules. OCR is not legal interpretation or a correctness guarantee.

## Limits and operations

- English only; at most 5 pages, 5 MiB input and 40,000 extracted characters.
- One OCR job at a time per API process; maximum 60 seconds total and 15 seconds per subprocess.
- Pages rasterized separately to at most 2,000 pixels on the longest side; generated files checked against a 20 MiB limit. Output and stderr handling are bounded; source-bearing logs are suppressed.
- Private temporary directory, original file mode 0600; files removed in `finally` after success/failure. Abrupt host/process termination can leave an orphan directory: configure host temp cleanup and protected temporary storage.
- No shell interpolation. These CLI tools are not a kernel sandbox: deploy with an unprivileged OS user, process/memory/disk quotas and patched packages. Do not expose enabled OCR on an unrestricted public host without those controls.
- Source hashes, page offsets and `ocr: true` provenance are saved; source remains immutable and all normal agreement/version approvals still apply.

The synthetic scanned-PDF regression runs real local tools when installed. Tests skip those external-tool checks on unsupported hosts; a skipped test is not OCR acceptance evidence. Password-protected/malformed documents, unreadable scans and timeouts return actionable errors without automatically retrying uploads or sending anything to an external service.
