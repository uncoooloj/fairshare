# Fairshare contract AI

Server-only, non-executable contract reading. It returns what the document says, with exact sentence-level quotes, and asks only about real gaps.

## Running it for real

Extraction tries Cloudflare Workers AI first and falls back to Anthropic. Configure either or both, server-side only (never `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`, never bundled into a frontend).

**Cloudflare Workers AI (primary)**

| Variable                | Required | Notes                                                                                                                                                                                                                                                         |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | yes      | 32 hex characters.                                                                                                                                                                                                                                            |
| `CLOUDFLARE_API_TOKEN`  | yes      | Token with Workers AI permission.                                                                                                                                                                                                                             |
| `CLOUDFLARE_AI_MODEL`   | no       | Defaults to `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (picked in the 2026-11 live bake-off, see below; 1M-token context). Must be a text-generation `@cf/<org>/<name>` model. Known reasoning models get per-model request options in `CLOUDFLARE_PROFILES`. |

`scripts/verify-contract-ai.mjs` reads the same `CLOUDFLARE_AI_MODEL`; the older `CLOUDFLARE_CONTRACT_MODEL` name is still accepted there.

**Anthropic (fallback)**

| Variable            | Required | Notes                            |
| ------------------- | -------- | -------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | Server-side API key.             |
| `ANTHROPIC_MODEL`   | no       | Defaults to `claude-sonnet-5-5`. |

Anthropic is used when Cloudflare is not configured, returns an HTTP/transport error, times out (30 s per provider by default; callers may pass `timeoutMs` up to 120 s), or returns output that fails validation. With neither configured the result is `MANUAL_REQUIRED` with `reason: NOT_CONFIGURED`, and no request is made.

Wiring: `apps/api/src/server.ts` (Node) and `apps/api/cloudflare/worker.ts` (Worker) map these variables into `extractContract(document, { accountId, apiToken, model, anthropic: { apiKey, model } })`. For the hosted Worker, set the tokens with `wrangler secret put`, not in `wrangler.jsonc` vars. Locally, export them into the API process (the server does not load `.env`). Then the user must tick the consent box, which sends `{ consentToCloudflare: true }`; the route is rate limited to 10 calls per user.

The Anthropic call uses the official SDK (`@anthropic-ai/sdk`, pinned) with structured outputs (`output_config.format` JSON schema, length/count limits stripped because the server enforces them), `effort: medium`, no tools, no retries, and the server-side refusal fallback (`fallbacks: "default"`). A refusal or any non-`end_turn` stop fails closed.

## What comes back

`ExtractionResult` (all enums, no string unions):

- `facts[]`: each `{ kind, subject, rawValue, citation: { start, end, quote } }` plus kind-specific fields:
  - `SHARE` → `basisPoints`. The name and the percentage must be in the same quote, and in a quote with several percentages the first one after the name must be this one ("respectively" is never paired).
  - `ADVANCE` → recipient in `subject`, `amountCents`, `recoupedBeforeSplit: boolean | null` (true only when the quote itself says the advance is repaid before the split).
  - `FEES` → `feePolicy` (`BEFORE_SPLIT` = fees off first / shares of net; `ORGANIZER_SHARE` = shares of gross, `feeBearer` pays), same values as the domain `FeePolicy`.
  - `REFUNDS` → `refundStep` (`BEFORE_SPLIT` or `FROM_PARTY_SHARE` with `chargedTo`). Display only: Rules has no refund field.
  - `TERM` → `boundary` (`START`/`END`) and `date` (YYYY-MM-DD, parsed in code from written dates; numeric day/month forms are rejected).
  - `PERSON` → people named, as written. `CURRENCY` → currency as written.
- `suggestedTitle` + `titleCitation`: a verbatim heading line from the first 4,000 characters.
- `issues[]` (max 3, one per topic, `SPLIT` > `ADVANCE` > `FEES`): `{ topic, question (≤ 90 chars, plain words), citation | null, readings[2–3] }`. Each reading is `{ label (≤ 40), explanation (one line), setting }`, where `setting` is the exact Rules change: `{ feePolicy, feeBearer? }`, `{ advanceRecoupedBeforeSplit }` or `{ shares: [{ name, basisPoints }] }` summing to 10,000. Names in readings must appear in the document.
- `sections`: per `SPLIT | ADVANCE | FEES | REFUNDS | TERM | PEOPLE`, `{ status: READ | ASK | NOT_FOUND, factIndexes, issueIndex }`. `SPLIT` is `READ` only when every share is consistent and they add up to exactly 100%.
- `rejections[]`: internal `{ item, index, reason }` codes for dropped facts/issues. Never show them verbatim to users.
- `provider`, `model`, `fallbackFrom`, `promptVersion` (`contract-extraction-v6`): internal metadata.
- Constants `requiresHumanReview: true`, `executable: false`.

## Validation rules

Every fact and issue is validated independently. Invalid ones are dropped with a reason code; valid ones are kept (partial acceptance). A malformed envelope, unknown top-level keys, or nothing valid at all fails the whole extraction closed (`MANUAL_REQUIRED`, `INVALID_OUTPUT`), and Anthropic is tried next if configured.

- Quotes must be one sentence or clause, at most 300 characters, and found verbatim in the source after collapsing whitespace. The stored citation is the exact original range. No fuzzy matching.
- `subject` and `rawValue` must both appear inside the quote. Kind-specific evidence is required (e.g. "recoup" for a recouped advance, "fee"/"net" for fee policy).
- Missing-information questions (`citation: null`) are dropped when accepted facts already answer the section. A cited ambiguity is retained even when the same section has accepted facts: a qualifying or conflicting clause still needs a human choice. Questions with legal jargon or over 90 characters are dropped.
- The setup wizard shows open questions beside their exact source clauses and offers possible fixes with per-person payment examples. Choices are human proposals, not claims of fairness; unchanged source text and all-party approval remain mandatory. Manual edits reopen affected decisions. The model only covers split, advance and fee questions, not every possible legal ambiguity.
- Both providers go through the same `validateDraft`.

## Integration contract

1. Authenticate the caller and check document membership before reading text. This package takes plain text only; it does not parse PDFs, fetch URLs or OCR.
2. Persist the result only under the authorized collaboration, with source hash, revision, model and prompt version. Check `isCurrentDraft` before displaying it as current.
3. Show facts as what the document says, with the quote, and ask people to confirm. Exact quotes prevent fabricated citations; they do not prove the model read the clause correctly. Human review is mandatory.
4. Never pass this result to allocation or payment functions. Convert confirmed observations into a new draft rules version; map names to verified members; never infer that an advance was paid.
5. `feeResolutionOptions()` returns labeled `SAMPLE_PROPOSAL` alternatives, not terms from the agreement.
6. No automatic retry beyond the one provider fallback. Never log raw provider responses, tokens or agreement text.

## Verification status

Deterministic tests cover both providers, the fallback path and the validation rules. Recorded Workers AI responses captured on 2026-11-11 are replayed offline from `test/fixtures/live/recorded/`; that validates the current parser against those stored responses, not current provider behavior.

Live eval (`npm run eval:live -w @fairshare/contract-ai`, see `scripts/live-eval.ts`): six synthetic agreements under `test/fixtures/live/` with hand-written expected readings, scored per field (people, shares, advance, fees, refunds, term, section statuses, questions, verbatim quotes). On 2026-11-11 the model bake-off on the v4 prompt scored:

| Model                           | Field accuracy | Valid JSON | Median latency | Cost / agreement        |
| ------------------------------- | -------------- | ---------- | -------------- | ----------------------- |
| qwen3.8-27b                     | 87%            | 6/6        | 95 s           | $0.0080                 |
| deepseek-v4.1-flash-1017        | 80%            | 5/6        | 27 s           | $0.0071                 |
| glm-5.3                         | 77%            | 6/6        | 6 s            | $0.0060                 |
| gpt-oss-120b                    | 68%            | 6/6        | 25 s           | $0.0015                 |
| llama-3.3-70b-instruct-fp8-fast | 58%            | 6/6        | 29 s           | $0.0024                 |
| gemma-4-26b-a4b-it              | 32%            | 0/6        | 116 s          | n/a (ran out of tokens) |

DeepSeek V4.1 Flash became the default based on the bake-off above. The recorded fixtures are synthetic and replayed offline; this repository does not use them as proof of current latency, cost, provider availability, or real-agreement accuracy. The Anthropic fallback has not been exercised live. Run the live eval on authorized synthetic input before making current provider-performance claims.
