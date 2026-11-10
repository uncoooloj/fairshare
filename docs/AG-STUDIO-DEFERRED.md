# Deferred AG Studio track

Status: preparation only, not a shipped AG Studio integration. No proprietary package installed, trial requested, licence accepted, provider call made, or public deployment performed. The existing AG Grid Community payout ledger remains separate.

## The meaningful product feature

Inside an agreement (not a new top-level destination), add a read-only **Explain this allocation** view with a custom allocation-waterfall widget. It must display the recoupment recipient, post-recoupment share, fee attribution and total, linked to the exact historical rule version and source clause. A narrow assistant can explain recorded amounts or list held incoming payments. It cannot approve rules, edit amounts, dispatch payouts, issue refunds or remove holds.

This supports the already agreed navigation: Overview, Agreements, Payouts, Settings. It does not add Clarifications/Analytics/Agents menu items.

## Prepared code

`packages/domain/src/analytics.ts` contains read-only historical projections and a strict two-action dispatcher. It returns deterministic ledger facts, checks membership and conservation, preserves review holds, and deliberately refuses to claim a payout status from an allocation. It is not exported by the package root, mounted on an API, or wired to AG Studio yet.

Five new tests cover recoupment, historical-version anchoring, forbidden actors, malformed money, immutable results and refusal of payment/mutation actions. All 21 domain tests and typecheck pass in this isolated branch.

Integration must load the aggregate through existing tenant/session authorization on every call. The actor is supplied by the session, never by LLM arguments. A revoked user must fail at the endpoint even if they remain in the historical aggregate. Consider whether all participants can see all amounts before exposing a cross-agreement tool; initial scope is one already-authorized agreement only.

## Studio implementation, after licence gate

1. Confirm appropriate AG Studio trial/licence for AI and judge access. Official pages advertise a 45-day trial; the generic licence text contains different evaluation-period language, so rely on the actual issued terms/key rather than assuming dates. Do not copy example keys from documentation.
2. Pin compatible `ag-studio` / `ag-studio-react` / grid/chart versions using the official compatibility matrix; don't blindly combine with our current Community grid version.
3. Register the AI module and wrap the relevant client boundary in `AgStudioProvider`.
4. Mount a custom waterfall widget with exact-cent deterministic data. Use integer cents for all totals and format only at display time. Source-clause text is untrusted data, never HTML or instructions.
5. Use Studio's `createAiHarness` plus a narrow custom agent. Prefer two custom server tools corresponding to the prepared dispatcher. Do not include the default broad agent team or mutations simply because they are available. Built-in report-layout tools can be added deliberately later, but cannot reach money APIs.
6. Connect an authenticated server-side Cloudflare adapter. Studio doesn't provide a model or a provider adapter. Never put Cloudflare credentials in the browser. Do not assume our current extraction model's tool-calling quality; test the adapter and fall back to deterministic explanation UI.
7. Test one real interaction ("Why was Jordan allocated $300?") and a hold query. Verify the output cites facts, never invents paid status, and resists an agreement clause asking it to execute a transfer. Test membership revoked during a request.
8. Validate browser layout, keyboard accessibility, loading/error states and maintain correct no-data behavior. Record genuine sponsor usage only after this is actually running.

## Remaining explicit gates

- No existing Studio licence has been established; ask owner for trial approval/key before adding deployment dependencies or requesting signup.
- No model-to-Studio tool loop has been tested.
- No backend route or UI is mounted from this preparation.
- Sponsor eligibility/award is not established by this preparatory code. Community AG Grid usage must not be called AG Studio usage.

## Official references checked November 10, 2026

- Product/trial: https://www.ag-grid.com/studio/
- Licence scope: https://www.ag-grid.com/studio/javascript/enterprise-licence/
- Agent quickstart: https://www.ag-grid.com/studio/r/ai-quickstart/
- Custom agents: https://www.ag-grid.com/studio/react/ai-custom-agents/
- Custom tools: https://www.ag-grid.com/studio/r/ai-tools/
- Custom widgets: https://www.ag-grid.com/studio/javascript/custom-widgets/
- Hackathon sponsor destination: https://paypalaihackathon.devpost.com/details/aggrid (fresh fetch timed out during this pass; don't claim a new eligibility verification)
