# Fairshare contract AI

Server-only, non-executable contract reading. It returns what the document says, with exact sentence-level quotes, and asks only about real gaps.

## Running it for real

Extraction tries Cloudflare Workers AI first and falls back to Anthropic. Configure either or both, server-side only (never `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`, never bundled into a frontend).

**Cloudflare Workers AI (primary)**

| Variable                | Required | Notes                                                                                                                                                                                                           |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | yes      | 32 hex characters.                                                                                                                                                                                              |
| `CLOUDFLARE_API_TOKEN`  | yes      | Token with Workers AI permission.                                                                                                                                                                               |
| `CLOUDFLARE_AI_MODEL`   | no       | Defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, the largest model Cloudflare lists as supporting `json_schema` response format (24k-token context). Must be a text-generation `@cf/<org>/<name>` model. |

`scripts/verify-contract-ai.mjs` reads the same `CLOUDFLARE_AI_MODEL`; the older `CLOUDFLARE_CONTRACT_MODEL` name is still accepted there.

**Anthropic (fallback)**

| Variable            | Required | Notes                            |
| ------------------- | -------- | -------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | Server-side API key.             |
| `ANTHROPIC_MODEL`   | no       | Defaults to `claude-sonnet-5-5`. |

Anthropic is used when Cloudflare is not configured, returns an HTTP/transport error, times out (30 s cap per provider), or returns output that fails validation. With neither configured the result is `MANUAL_REQUIRED` with `reason: NOT_CONFIGURED`, and no request is made.

Wiring: `apps/api/src/server.ts` (Node) and `apps/api/cloudflare/worker.ts` (Worker) map these variables into `extractContract(document, { accountId, apiToken, model, anthropic: { apiKey, model } })`. For the hosted Worker, set the tokens with `wrangler secret put`, not in `wrangler.jsonc` vars. Locally, export them into the API process (the server does not load `.env`). Then the user must tick the consent box, which sends `{ consentToCloudflare: true }`; the route is rate limited to 10 calls per user.

The Anthropic call uses the official SDK (`@anthropic-ai/sdk`, pinned) with structured outputs (`output_config.format` JSON schema, length/count limits stripped because the server enforces them), `effort: medium`, no tools, no retries, and the server-side refusal fallback (`fallbacks: "default"`). A refusal or any non-`end_turn` stop fails closed.

## What comes back

`ExtractionResult` (all enums, no string unions):

- `facts[]`: each `{ kind, subject, rawValue, citation: { start, end, quote } }` plus kind-specific fields:
  - `SHARE` → `basisPoints`. The name and the percentage must be in the same quote, and in a quote with several percentages the first one after the name must be this one ("respectively" is never paired).
  - `ADVANCE` → recipient in `subject`, `amountCents`, `recoupedBeforeSplit: boolean | null` (true/false only if the quote says so).
  - `FEES` → `feePolicy` (`BEFORE_SPLIT` = fees off first / shares of net; `ORGANIZER_SHARE` = shares of gross, `feeBearer` pays), same values as the domain `FeePolicy`.
  - `REFUNDS` → `refundStep` (`BEFORE_SPLIT` or `FROM_PARTY_SHARE` with `chargedTo`). Display only: Rules has no refund field.
  - `TERM` → `boundary` (`START`/`END`) and `date` (YYYY-MM-DD, parsed in code from written dates; numeric day/month forms are rejected).
  - `PERSON` → people named, as written. `CURRENCY` → currency as written.
- `suggestedTitle` + `titleCitation`: a verbatim heading line from the first 4,000 characters.
- `issues[]` (max 3, one per topic, `SPLIT` > `ADVANCE` > `FEES`): `{ topic, question (≤ 90 chars, plain words), citation | null, readings[2–3] }`. Each reading is `{ label (≤ 40), explanation (one line), setting }`, where `setting` is the exact Rules change: `{ feePolicy, feeBearer? }`, `{ advanceRecoupedBeforeSplit }` or `{ shares: [{ name, basisPoints }] }` summing to 10,000. Names in readings must appear in the document.
- `sections`: per `SPLIT | ADVANCE | FEES | REFUNDS | TERM | PEOPLE`, `{ status: READ | ASK | NOT_FOUND, factIndexes, issueIndex }`. `SPLIT` is `READ` only when every share is consistent and they add up to exactly 100%.
- `rejections[]`: internal `{ item, index, reason }` codes for dropped facts/issues. Never show them verbatim to users.
- `provider`, `model`, `fallbackFrom`, `promptVersion` (`contract-extraction-v4`): internal metadata.
- Constants `requiresHumanReview: true`, `executable: false`.

## Validation rules

Every fact and issue is validated independently. Invalid ones are dropped with a reason code; valid ones are kept (partial acceptance). A malformed envelope, unknown top-level keys, or nothing valid at all fails the whole extraction closed (`MANUAL_REQUIRED`, `INVALID_OUTPUT`), and Anthropic is tried next if configured.

- Quotes must be one sentence or clause, at most 300 characters, and found verbatim in the source after collapsing whitespace. The stored citation is the exact original range. No fuzzy matching.
- `subject` and `rawValue` must both appear inside the quote. Kind-specific evidence is required (e.g. "recoup" for a recouped advance, "fee"/"net" for fee policy).
- Issues whose section is already `READ` from accepted facts are dropped. Questions with legal jargon or over 90 characters are dropped.
- Both providers go through the same `validateDraft`.

## Integration contract

1. Authenticate the caller and check document membership before reading text. This package takes plain text only; it does not parse PDFs, fetch URLs or OCR.
2. Persist the result only under the authorized collaboration, with source hash, revision, model and prompt version. Check `isCurrentDraft` before displaying it as current.
3. Show facts as what the document says, with the quote, and ask people to confirm. Exact quotes prevent fabricated citations; they do not prove the model read the clause correctly. Human review is mandatory.
4. Never pass this result to allocation or payment functions. Convert confirmed observations into a new draft rules version; map names to verified members; never infer that an advance was paid.
5. `feeResolutionOptions()` returns labeled `SAMPLE_PROPOSAL` alternatives, not terms from the agreement.
6. No automatic retry beyond the one provider fallback. Never log raw provider responses, tokens or agreement text.

## Verification status

Deterministic tests cover both providers with recorded fixture responses, the fallback path and the validation rules. No live provider call was made for v4. The Anthropic structured-output schema and the Workers AI `json_schema` behavior for this schema have not been exercised live. The 2026-11-10 live run (`docs/ai-live-verification.json`) used the earlier v3 prompt and three synthetic sentences; it says nothing about v4 quality. Before claiming accuracy on real contracts, run `scripts/verify-contract-ai.mjs` and a labelled eval on realistic documents.
