# Fairshare product and design brief

10 November 2026 • Product direction for design and engineering

## What we are building

Fairshare is a web application that turns a collaboration agreement into transparent, approved revenue allocation rules. When revenue arrives, the system calculates what each person is entitled to, tracks the resulting payouts and explains every amount using the agreement and transaction history.

The core promise is simple: **The money follows the agreement.**

This is not a bill splitter, a contract-signing service or a chatbot with a payment button. Its distinctive value is the connection between a source clause, the rules everyone approved, a deterministic calculation and the actual payment record.

## The journey in one view

Create a collaboration → add the agreement → review the proposed rules → resolve ambiguity together → approve a version → receive revenue → calculate allocations → track payouts → explain any amount.

AI interprets and explains. Collaborators agree. Deterministic code calculates. PayPal executes supported sandbox payment operations. These responsibilities should remain visible in the design.

## Decisions to design around

- The product name is Fairshare. Earlier names in concept images are obsolete. Trademark and domain availability remain unchecked.
- The product is desktop web first. Responsive collaborator review is useful, but earlier native concept screens are not the new platform specification.
- Use a clean professional SaaS workspace: white surfaces, restrained blue accents, compact typography, thin dividers and generous whitespace.
- Payouts stays in primary navigation. Clarification is part of agreement setup, not a menu destination.
- There is no routine approval or rejection of someone’s calculated share after the rules are active.
- The design intent in this brief takes precedence over contradictory generated image labels, example values and menus.

## Scope and evidence

The hackathon implementation uses PayPal sandbox, not live money. PayPal authentication has succeeded, but the complete checkout, capture, webhook and payout paths have not yet been verified. This document describes the intended product, not completed functionality. The dashboard is being designed while backend work proceeds in a separate Fairshare repository.

---PAGE---

# People and product structure

## Who uses Fairshare

**Organizer** creates the collaboration, uploads the source agreement, invites participants and supplies the merchant connection used by the collaboration. Organizing does not grant a right to rewrite everyone’s shares. An organizer may also be a revenue recipient, but those are separate roles.

**Collaborator** reviews the terms that affect them, asks questions, proposes changes and approves an exact rule version. They see their allocation, the shared calculation context and their payout status. They provide or verify their own recipient details when required.

**Buyer** pays for a product or service through the relevant checkout. They do not have to join Fairshare or understand the collaboration’s internal split.

**AI assistant** proposes interpretations and clarifications, identifies missing information and explains recorded calculations. It is not a legal decision-maker, a signatory or an unrestricted money-moving actor.

## Main navigation

| Destination | Why it exists                     | Primary content                                                             |
| ----------- | --------------------------------- | --------------------------------------------------------------------------- |
| Overview    | Know what needs attention         | Pending reviews, payment exceptions, recent activity and concise totals     |
| Agreements  | Manage agreements and shared work | Agreement list and each agreement’s workspace, including people and revenue |
| Payouts     | Inspect outgoing money            | Recipient amounts, payment status, schedule and exceptions                  |
| Settings    | Manage account and connections    | Profile, merchant connection and relevant preferences                       |

The primary product object is an agreement. Documents, people, clarifications, rule versions and incoming revenue live inside its workspace. Backend collaboration aggregates may retain their internal names. A separate global Collaborators directory and Library are not needed for the first version. A future cross-collaboration search does not require creating empty menu items now.

## Agreement workspace

The workspace should answer: What did we agree? Who has approved? What money has arrived? What is each person owed? Has it been paid?

Use contextual sections such as Summary, Agreement, People and Activity. Revenue stays contextual to the agreement. Payout links may open the global payouts view filtered to this agreement. Do not create duplicate sources of truth.

The agreement list should show a real metric such as **Revenue received**, with currency and period, not a column that repeats “Revenue share” on every row. Until reliable values exist, omit the metric. Do not combine different currencies into an unlabeled total.

---PAGE---

# Onboarding and collaboration setup

## Organizer journey

1. **Create account or sign in.** Collect the minimum identity information needed. Show an identifiable current user in the header. Initials are a fallback for a real profile name, not decorative placeholders.
2. **Create collaboration.** Ask for its name and a short description. Let the organizer save and return. A creative role such as producer is separate from permissions such as organizer or participant.
3. **Add the source agreement.** Offer upload, paste text and a clearly labeled sample. State what formats and size limits the implementation actually supports. Do not promise DOCX, PDF or scanned-document extraction until supported.
4. **Identify participants.** Match names in the agreement to invited accounts. Unknown or ambiguous names must be resolved rather than silently assigned. Confirm the advance recipient separately from the organizer’s role.
5. **Review the proposed rules.** Do this before asking people to activate them. Invitations can be drafted during setup; sending one is a distinct action.
6. **Connect payment capability when needed.** The organizer’s merchant setup and collaborators’ recipient details are different tasks. Do not imply that every participant needs to supply merchant API keys. Provider-specific onboarding depends on the integration chosen and verified.

## Invitee journey

The invitation identifies the collaboration and inviter, without exposing the full agreement to an unauthenticated visitor. After the invitee authenticates with the intended identity, show their role, proposed share, recoupment effect and the exact version awaiting review.

Actions are **Approve this version**, **Request a change** and **Ask a question**. A person can inspect the source and example calculation before deciding. Approval of the app’s allocation rules is not presented as signing or legally amending the original agreement.

Show invitation states separately from rule approvals: an invitation may be sent or accepted while approval is still pending. Expired, revoked, wrong-account and already-accepted links need clear recovery paths. A successful sign-in should return the person to the invitation rather than drop them on a generic dashboard.

## Design states to include

Empty collaboration; saved draft; file selected; upload in progress; unsupported or unreadable document; extraction failed; missing participant match; invitation pending; invitation accepted; access denied; retry without losing completed work.

---PAGE---

# From agreement to approved rules

## Review proposed interpretation

The rule-review screen places a source clause beside the structured rule it supports. Selecting a rule reveals its citation and exact excerpt. The document need not occupy half the screen permanently; a source drawer can preserve a calmer working view.

Extract only what is supported. If the agreement does not specify a percentage, advance amount or recipient, show a missing value. Do not turn a plausible guess into a “found” term. Separate source-derived rules, AI suggestions and human clarifications visually.

The proposed rule set should cover participants and shares; eligible revenue; currency; deductions and fees; recoupment amount, recipient and starting balance; payout conditions; and effective version. Percentages, recipients and calculations must pass deterministic validation before activation.

## Resolve ambiguity collaboratively

The agent should explain the uncertain term, propose useful alternatives and show how each affects the parties. Avoid declaring one option universally fair. The goal is a shared, understandable resolution, not one party winning a hidden negotiation.

For a fee ambiguity, the agent might suggest sharing fees proportionally or having the organizer cover them. The person can select an option, edit its wording or propose another approach. Show the proposed wording and financial effect before **Send proposal for review**.

| Example with no recoupment                         | Maya 50% | Jordan 30% | Riley 20% | Fee |
| -------------------------------------------------- | -------: | ---------: | --------: | --: |
| $1,000 revenue with $30 deducted before splitting  |     $485 |       $291 |      $194 | $30 |
| Organizer Maya covers the $30 from her gross share |     $470 |       $300 |      $200 | $30 |

Both examples conserve the original $1,000. Neither option benefits every person equally. Explain that tradeoff plainly. If the organizer’s share cannot cover the fee, require an explicit supported policy rather than silently creating a negative payout.

## Version and approval behavior

A material change produces a new version and requires all relevant collaborators to review that version. Display pending, approved and changes-requested states per person. Do not show the overall agreement as active while required approvals are missing.

Once approved and valid, the rules become active for their stated scope. Previous versions, comments and decisions remain inspectable. Historical transactions stay attached to the version used for them. Changing future rules must not silently rewrite old receipts. Any legal amendment or electronic-signature workflow is outside this initial product scope.

---PAGE---

# How the money works

## Three distinct concepts

**Revenue** is incoming money for the agreement, shown within its workspace rather than a standalone global tab. A payment event has its own provider status. Returning from checkout is not enough to prove payment succeeded.

**Allocation** is a calculated entitlement under an approved rule version. It is a ledger result, not proof that money was sent. The calculation uses exact minor currency units and an explicit rounding policy, not model-generated arithmetic.

**Payout** is the actual transfer to a recipient. One revenue event may produce multiple payout items, and their outcomes may differ. A confirmed incoming payment can coexist with a processing or failed outgoing payout.

## Canonical demonstration example

Use one consistent sample collaboration with Maya, Jordan and Riley. The example agreement specifies a previously recorded $2,000 advance to be recouped by Maya, then a 50% / 30% / 20% split of the remaining eligible revenue. Verify or explicitly confirm the starting recoupment balance; uploading a contract alone does not prove that an advance was paid.

For this illustration, eligible revenue is $3,000 after any agreed deductions. The fee policy is deliberately separate from this example, so no amount disappears into an unstated fee.

| Recipient | Advance recoupment | Share of remaining $1,000 | Total entitlement |
| --------- | -----------------: | ------------------------: | ----------------: |
| Maya      |             $2,000 |                      $500 |            $2,500 |
| Jordan    |                 $0 |                      $300 |              $300 |
| Riley     |                 $0 |                      $200 |              $200 |
| Total     |             $2,000 |                    $1,000 |            $3,000 |

The $2,000 is not removed from accounting. It belongs to a named recipient and must remain visible in allocation and payout records. If a provider payout fee applies, show its treatment separately under the approved policy.

After this event, the advance remaining is $0. A second $1,000 eligible revenue event allocates $500, $300 and $200. This demonstrates that recoupment is stateful, not a repeated deduction on every sale.

## Why there is no routine payout vote

Participants approve rules before activation. Once revenue is confirmed, the engine applies those rules. Nobody gets a routine approve-or-decline control over another person’s calculated amount. A payout may still wait for its agreed schedule, available funds, valid recipient details or a genuine risk exception. Show the reason without implying that the entitlement has changed.

---PAGE---

# Revenue and payouts experience

## Revenue list and detail

Use a practical table with event, collaboration, date, currency, gross received amount where available, eligible amount, payment status and allocation state. Keep fees visible in the detail. Filters should help find events, not repeat information already obvious from context.

Opening an event reveals the verified payment record, deductions, recoupment, recipient allocations and the rule version used. The activity trail distinguishes provider confirmation from a calculated result. If the status is uncertain, prevent an unsafe repeat payment or payout.

Use plain copy tied to the actual event:

- **Waiting for buyer:** The buyer has not completed the required payment step.
- **Payment processing:** We are waiting for PayPal to confirm this payment.
- **Payment confirmed:** The provider has confirmed the payment.
- **Split calculated:** Each person’s entitlement has been recorded under the approved rules.

Do not mix “checkout initiated” with “payment completed.” Do not offer a promise of safe cancellation while the provider outcome is unknown. A timeout requires status reconciliation, not a blind retry.

## Payout list and detail

Payouts is a permanent primary destination. Show recipient, collaboration, source event or batch, amount, currency, status and last update. Opening an item reveals its calculation, source clause, provider reference and status timeline.

Design for Scheduled, Processing, Completed, Failed, Unclaimed and Needs attention. Provider acceptance of a batch is not proof every recipient was paid. Retain item-level outcomes and retry only when the backend has determined it is safe. Never duplicate successful items during recovery.

There is no generic “approve share” button. Show contextual actions such as **Update recipient details**, **View payment** or **Contact support**, when relevant and authorized. Do not expose other collaborators’ private payment credentials.

## Explain an amount

“Why is Jordan allocated $300?” should open structured evidence: eligible revenue $3,000; recoupment $2,000; remaining $1,000; Jordan’s approved share 30%; allocation $300. Link the source clause, rule version and payment record. Show payout status separately below it.

A contextual assistant can answer follow-up questions using these recorded facts. It cannot silently change rules, invent a clause or send another payout through chat. **Flag a discrepancy** creates an auditable issue for review, not an automatic reversal.

---PAGE---

# States and safeguards to design

## Rule lifecycle

Draft → Reading agreement → Needs clarification → Awaiting approvals → Active. Changes requested returns the proposal to revision. Superseded versions remain readable. An active rule can be paused for a defined operational reason without being erased or rewritten.

## Important exceptions

| Situation                          | What the person sees              | Safe behavior                          |
| ---------------------------------- | --------------------------------- | -------------------------------------- |
| Missing or ambiguous rule          | Exact question and source         | No activation until resolved           |
| Shares do not total 100%           | Inline validation                 | No calculation using invalid rules     |
| A collaborator requests a change   | Comment and affected version      | New proposal needs renewed approval    |
| AI unavailable                     | Existing source and saved work    | Retry or explicit manual review        |
| Duplicate payment event            | One existing transaction          | No duplicate allocation or payout      |
| Unknown provider outcome           | Processing or needs review        | Reconcile before retrying              |
| Recipient cannot receive payout    | Specific item needs attention     | Keep entitlement; do not mark paid     |
| One payout fails                   | Mixed item-level results          | Preserve successes and isolate failure |
| Refund or reversal arrives         | Affected payment needs review     | Pause affected outgoing funds safely   |
| Funds already paid before reversal | Visible exception and audit trail | No invented automatic clawback         |

## Access and transparency

A collaborator needs enough shared financial context to understand their share and the agreed rules. They do not need access to others’ credentials, private account identifiers or unrelated collaborations. The organizer’s operational role is not unlimited permission to change entitlement.

Record who proposed a clarification, who approved which version, the timestamp, calculation inputs, provider events and any override or exception resolution. Audit history must explain decisions without exposing secrets.

## Design the unavailable states honestly

A preview is labeled **Preview only**. A genuine sandbox operation is labeled **Sandbox**. Waiting for confirmation is not success. A missing integration should not be represented by a green badge. The demo can use a sample agreement, identities and product, but must distinguish those fixtures from actual provider responses.

---PAGE---

# Screen map and design direction

## Priority frames

| Frame                       | Main job                              | Primary action                             |
| --------------------------- | ------------------------------------- | ------------------------------------------ |
| Account and sign in         | Establish the real user               | Create account or sign in                  |
| Empty overview              | Explain the next meaningful step      | Create collaboration                       |
| Collaboration setup         | Define the work and add source        | Review agreement                           |
| Proposed rules              | Inspect extraction and missing facts  | Resolve questions                          |
| Clarification proposal      | Compare effects on all parties        | Send proposal for review                   |
| Invitee review              | Understand terms and source           | Approve version or request change          |
| Allocation preview          | Demonstrate the rule logic            | Return to review or activate when eligible |
| Active collaboration        | See agreement and current activity    | View revenue or people                     |
| Revenue detail              | Explain incoming money and allocation | View calculation                           |
| Payout detail               | Track an outgoing item                | Resolve a specific exception if needed     |
| Explanation and discrepancy | Trace an amount to evidence           | Ask a question or flag issue               |
| Settings and connection     | Configure the user and provider       | Connect or update configuration            |

## Visual system

Use the accepted Apollo and Relevance AI references for professional information architecture and restraint, not their branding or content. The approved direction is a quiet white workspace, compact readable sans-serif typography, fine borders, aligned tables and plenty of whitespace. Royal blue is an accent for selection and primary actions rather than a large decorative surface.

Use the existing Onest-inspired typography and blue #1F4EE8 as a starting point. Avoid the earlier serif, beige, large photographic collage and dense multi-panel promotional layouts. Show one clear primary action per step. Expose source clauses and detailed calculations in contextual drawers where that reduces clutter.

Keep sidebar labels and positions consistent across every frame. Use Overview, Agreements, Payouts and Settings. Do not add Clarifications, Library or a global Collaborators screen merely to fill navigation.

## Consistency rules

Use Fairshare everywhere. Use one example collaboration and the same people, percentages and amounts across frames. Represent statuses with text as well as color. Align numbers and display currency. Distinguish an empty state from missing data. Do not rely on unexplained initials; show real display names in contextual people lists. Final copy remains open to refinement, but financial meaning must remain exact.

---PAGE---

# Delivery scope and open decisions

## What the hackathon version should prove

The demonstration should show a source agreement becoming inspectable rules, a meaningful ambiguity resolved through a proposal, the participants approving a version, a real PayPal sandbox payment where supported, a deterministic allocation and an explainable payout record. A second revenue event should demonstrate the changed recoupment balance.

The product story is not “AI calculates percentages.” It is that everyone can see how agreed words become traceable financial outcomes, and exceptions do not disappear behind automation.

## Provider and operational decisions still to verify

- Actual PayPal checkout, capture, refund, webhook and Payouts capability, including merchant eligibility and recipient outcomes.
- How approved payout scheduling maps to supported provider actions. Automatic submission must not be claimed before this is verified.
- Public HTTPS callbacks and reliable judge access, without exposing credentials or private source data.
- Exact provider fees, balance availability and payout funding requirements. A captured payment followed by a payout is not automatically escrow or marketplace split settlement.
- The operational response to chargebacks, already-paid reversals and disputed allocations. A hold is not a complete resolution process.
- Final supported file types, extraction limitations and the privacy/access policy for uploaded agreements.

## Deliberate first version boundaries

Single-currency examples are preferred. Do not silently introduce FX, tax calculation, legal advice, contract execution, general-purpose banking, live escrow or universal payment routing. Do not claim live production eligibility from sandbox behavior.

Sponsor tools should serve the journey: a capable table for revenue and payouts, trusted API context for PayPal integration, and appropriate deployment infrastructure. Their use must be genuine and documented, not a reason to add confusing screens.

## Designer handoff acceptance checklist

- A new organizer and an invited collaborator can each follow their complete journey.
- Every extracted rule has a source or is labeled as a proposal.
- Clarification proposals can be revised and reviewed by all affected people.
- No routine control lets someone reject an already-agreed calculated share.
- Revenue, allocations and payouts are distinct throughout the design.
- The $2,000 recoupment has a named recipient and remains in the accounting.
- Loading, failure, pending approval, uncertainty and partial payout results have designs.
- The final frames use Fairshare, the agreed navigation and a consistent example.

This brief reflects OJ’s product and design decisions through 10 November 2026. It is the implementation and design brief, not a legal agreement or a statement that all specified behavior is already built.
