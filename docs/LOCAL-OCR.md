# Local scanned-PDF OCR

OCR runs entirely on the API host: Apple Vision/PDFKit on macOS, or Poppler/Tesseract on Linux. No document is uploaded to an OCR provider. It is separate from the opt-in Cloudflare rule interpretation step.

## Enable

On macOS, install Apple Xcode command-line tools. The API compiles its bundled Swift helper into a private temporary directory at startup; no Homebrew packages are needed. Native Vision must be available to the server process (restricted execution sandboxes can deny it). The helper is deleted on normal process exit.

On Linux, install maintained `poppler-utils` and `tesseract-ocr` with English language data from the host OS's official package repository. The process searches `/usr/local/bin`, `/usr/bin`, `/bin` and `/opt/homebrew/bin`; no application credentials are passed to these subprocesses. On either host, set `LOCAL_OCR_ENABLED=true` and restart the API. Startup fails if required tools cannot run. Default is off; the app offers paste-text fallback when unavailable.

For each scanned PDF, the user must select **Use OCR** before uploading. Text-layer PDF processing never silently falls back to OCR. Uploaded originals remain authenticated attachments, not public links. OCR output is labelled and requires checking every amount, percentage and name against the original before proposing rules. OCR is not legal interpretation or a correctness guarantee.

## Limits and operations

- English only; at most 5 pages, 5 MiB input and 40,000 extracted characters.
- One OCR job at a time per API process; the default extraction budget is 60 seconds, with at most 15 seconds for each recognition/rasterization subprocess. Native helper compilation is normally warmed during startup and has its own 60-second limit.
- macOS recognition uses English Apple Vision with language correction disabled and a 15-second recognition subprocess deadline. The local helper compile has a separate 60-second startup deadline.
- Pages are rasterized separately to a target longest edge of 2,000 pixels. Linux checks each generated image file against a 20 MiB limit; macOS keeps its raster in memory. Output is bounded and source-bearing stderr is discarded.
- Private temporary directory, original file mode 0600; files removed in `finally` after success/failure. Abrupt host/process termination can leave an orphan directory: configure host temp cleanup and protected temporary storage.
- No shell interpolation. These CLI tools are not a kernel sandbox: deploy with an unprivileged OS user, process/memory/disk quotas and patched packages. Do not expose enabled OCR on an unrestricted public host without those controls.
- Source hashes, page offsets and `ocr: true` provenance are saved; source remains immutable and all normal agreement/version approvals still apply.

The synthetic scanned-PDF regression runs real local tools when installed. Tests skip those external-tool checks on unsupported hosts; a skipped test is not OCR acceptance evidence. Password-protected/malformed documents, unreadable scans and timeouts return actionable errors without automatically retrying uploads or sending anything to an external service.

## Cloudflare

Neither native OCR adapter runs inside a plain Cloudflare Worker. Keep OCR capability disabled there until a compatible parser deployment is configured and tested. Local Mac acceptance does not establish cloud OCR readiness.
