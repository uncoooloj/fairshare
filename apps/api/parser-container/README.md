# Private document parser

Stateless Node service for the API Worker. PDF/DOCX parsing and OCR need subprocesses unavailable in Workers. It reuses the bounded parsers rather than sending agreements to an AI OCR vendor.

## Boundary

- **Private Cloudflare Container binding only. Never publish port 8080 or a public parser Worker route.** The authenticated API checks membership and OCR consent before invoking it.
- Configure Container `enableInternet: false`; no secrets, bindings, database or permanent volume. The image runs as non-root. Original documents remain in the API's authorized storage, not the parser.
- One request at a time; excess requests get 429. Input 5 MiB, PDF 20 pages, OCR 5 English pages, text 40,000 characters. Existing child-process time/output/memory bounds apply; OCR temp files are removed in `finally`.
- Enforce a small Container instance/memory limit and idle shutdown at deployment. Native OCR memory is limited by the Container, not V8.
- API `cloudflareDocumentReaders(binding)` validates response size, original-file SHA-256, text/page bounds and OCR provenance. Missing binding returns 503, never a fake extraction. `OCR_ENABLED` must remain off until the service is configured and smoke-tested.
- No source-bearing logs, third-party calls or automatic AI extraction. OCR remains a separate explicit upload choice. Hosted UI discloses Cloudflare processing.

## Build / verify

From repository root:

```sh
docker build -f apps/api/parser-container/Dockerfile -t fairshare-parser .
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m --memory 512m --cpus 1 fairshare-parser
node --import tsx --test apps/api/test/parser-container.test.ts
```

The network-disabled command checks startup only; a production request enters through the private Container binding. Use synthetic fixtures for acceptance, never a real agreement without authorized hosting consent.

## Deployment status

Source service and local HTTP DOCX/concurrency/missing-binding tests pass. OCR was
skipped on this host because Poppler is unavailable. No Container has been created
or deployed, and the Docker image has not been built. Cloudflare Container account
availability, paid-plan/billing approval, private binding/egress configuration,
image build and hosted synthetic smoke tests remain required. Do not describe
these local tests as hosted validation.

`apps/api/wrangler.jsonc` now declares the private Container DO binding. Its class
disables outbound internet and sleeps after one idle minute. Manifest validation
is not a Docker image build or hosted parsing verification.
