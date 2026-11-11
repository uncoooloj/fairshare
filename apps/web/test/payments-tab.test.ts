import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agreement } from "../lib/model";
import type { AgreementPaymentsTabProps } from "../components/sections/agreement-tabs/payments-tab";

// The payments tab pulls in the recovery drawer's CSS module. Stub it to keep
// this SSR check aligned with the existing component test harness.
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const { AgreementPaymentsTab } =
  require("../components/sections/agreement-tabs/payments-tab.tsx") as typeof import("../components/sections/agreement-tabs/payments-tab");

const agreement: Agreement = {
  workspaceId: "workspace-1",
  id: "agreement-1",
  revision: 1,
  value: {
    name: "Release",
    members: [{ userId: "user-1", displayName: "Maya", role: "ORGANIZER" }],
    versions: [
      {
        id: 1,
        status: "ACTIVE",
        approvals: {},
        changeRequests: [],
        rules: {
          currency: "USD",
          shares: [{ userId: "user-1", basisPoints: 10000 }],
          feePolicy: "BEFORE_SPLIT",
          source: {
            origin: "HUMAN_PROPOSAL",
            documentId: "document-1",
            clause: "Revenue",
            excerpt: "Revenue is split equally.",
          },
          unresolvedQuestions: [],
        },
      },
    ],
    activeVersionId: 1,
    revenue: [],
    recoupedByAdvance: {},
    reviewHold: false,
    audit: [],
  },
};

const props = (payments: any[]): AgreementPaymentsTabProps => ({
  selected: agreement,
  active: agreement.value.versions[0],
  user: { id: "user-1", name: "Maya", email: "maya@example.com" },
  base: "/agreements/agreement-1",
  organizer: true,
  busy: false,
  payments,
  payouts: [],
  run: async (action) => {
    await action();
  },
  refresh: async () => {},
  setBreakdown: () => {},
});

test("payment recovery guidance appears only after a payment is recorded", () => {
  const empty = renderToStaticMarkup(
    createElement(AgreementPaymentsTab, props([])),
  );
  assert.match(empty, /No payments yet/);
  assert.doesNotMatch(empty, /Something wrong with a payment\?/);
  assert.doesNotMatch(empty, /ag-fix-link/);

  const nonempty = renderToStaticMarkup(
    createElement(
      AgreementPaymentsTab,
      props([
        {
          id: "payment-1",
          source_name: "PayPal",
          amount: 1000,
          status: "ALLOCATED",
        },
      ]),
    ),
  );
  assert.match(nonempty, /Something wrong with a payment\?/);
  assert.match(nonempty, /class="ag-fix-link/);
});
