# Fairshare contract AI

Server-only, non-executable contract observations and sample ambiguity-resolution proposals.

## Integration contract

1. Authenticate caller and check document membership/authorization before reading text.
2. Extract plain text from the authorized upload in the host app. This package accepts text only; it does not parse PDFs, fetch URLs or perform OCR. Reject unreadable/oversized documents, do not silently truncate them.
3. With the user's authorized provider-processing scope, call `extractContract({documentId,revision,text}, config)` on the server. Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and an explicit **text generation** model via `CLOUDFLARE_CONTRACT_MODEL`; Kept's Clef classification model cannot perform contract extraction. Map these environment variables to the config. Credentials must never be `EXPO_PUBLIC_*` or bundled into a frontend.
4. Persist result only under the authorized collaboration. Preserve source hash, revision, model and prompt version. Before applying/displaying as current, check `isCurrentDraft`; enforce that check transactionally with the host's current revision to prevent a stale async response replacing a newer document.
5. Display facts as **AI-proposed observations**, source quote and original clause side by side. Exact quote validation prevents fabricated citations but does not establish semantic entailment, legal validity or factual authenticity. A model can still associate the wrong nearby subject/value. Human review is mandatory.
6. Missing fields and ambiguity must block rule activation in the domain. Never pass this result directly to allocation or payment functions. Convert reviewed observations to a new domain draft version; resolve names to verified participant identities, convert explicit amounts to cents, percentages to basis points using deterministic code, and verify recoupment balances independently. Never infer that an advance was paid from the contract alone.
7. `feeResolutionOptions()` returns explicitly labeled SAMPLE_PROPOSAL alternatives, not terms extracted from the agreement and not a claim of objective fairness. Domain mappings: PROPORTIONAL → BEFORE_SPLIT; ORGANIZER → ORGANIZER_SHARE plus verified feeBearerId. Use the domain allocation preview for numeric examples; this package does not ask an LLM to calculate money. Any material change requires new version + all-party review. Approval of application rules is not automatic legal amendment.
8. No auto-retry of malformed extraction. Invalid/unavailable response gives MANUAL_REQUIRED with no partial facts. User can retry explicitly or draft manually. Logging raw provider responses, tokens or agreement text is prohibited in the host.

## Scope and provider verification

The adapter uses Cloudflare Workers AI text-generation response shape (`result.response`) over HTTPS with redirects disabled, bounded input/output and timeout. It uses zero tools and never fetches document links. Prompt injection is treated as untrusted text, not an authority; no guarantee is made that a language model will always obey extraction instructions. Human review and non-executable output remain the safety boundary.

Current validation: 20 deterministic tests and TypeScript pass. On 2026-11-10, the server package was exercised against actual Cloudflare Workers AI with `@cf/meta/llama-3.3-70b-instruct-fp8-fast` using three synthetic fixtures. All returned HTTP 200, exact server-owned source citations and REVIEW_REQUIRED (never approved/executable). Simple share and multi-party advance/split fixtures included expected tokens; an injected payout instruction was not extracted as a recipient/amount. See `docs/ai-live-verification.json`.

Initial live attempts exposed unreliable model-generated offsets, Markdown formatting and schema drift. V2 requests Cloudflare JSON Schema mode and supplies server-owned source span IDs. The model chooses a span; code resolves it to the actual source quote/offsets and verifies verbatim subject/value membership. Unknown spans fail closed. Exact unique quote anchoring remains as a compatibility path for earlier structured responses, never fuzzy matching.

This is a small synthetic acceptance set, not a broad quality/safety certification. Semantic relationship errors remain possible even when the words are in a cited span. Human review remains mandatory. No private contracts, payment operations, credential output or raw provider logs were included in published evidence. The host HTTP/UI flow and production privacy/retention settings still require separate verification. Cloudflare JSON Schema documentation: https://developers.cloudflare.com/workers-ai/features/json-mode/

APIMatic belongs to the PayPal integration context, not this extraction layer. Do not claim its use here.
