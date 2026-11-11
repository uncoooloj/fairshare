import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewDashboard } from "../components/overview-dashboard";
import type { Agreement } from "../lib/model";

function agreement(
  role: "ORGANIZER" | "COLLABORATOR" = "ORGANIZER",
): Agreement {
  return {
    id: "a",
    workspaceId: "w",
    revision: 1,
    value: {
      name: "Studio",
      members: [
        { userId: "me", displayName: "Maya", role },
        { userId: "other", displayName: "Riley", role: "COLLABORATOR" },
      ],
      versions: [
        {
          id: 1,
          status: "AWAITING_APPROVAL",
          approvals: {
            me: "2026-11-10T12:00:00Z",
            other: "2026-11-10T12:00:00Z",
          },
          changeRequests: [],
          rules: {
            currency: "USD",
            shares: [],
            feePolicy: "BEFORE_SPLIT",
            source: {
              origin: "DOCUMENT",
              documentId: "d",
              clause: "4",
              excerpt: "split",
            },
            unresolvedQuestions: [],
          },
        },
      ],
      revenue: [],
      reviewHold: false,
      recoupedByAdvance: {},
      audit: [],
    },
  };
}

function render(agreements: Agreement[]) {
  return renderToStaticMarkup(
    createElement(OverviewDashboard, {
      agreements,
      payouts: [],
      payoutsComplete: true,
      payoutsUnavailable: false,
      userId: "me",
      onOpen: () => {},
      onSendReminder: () => {},
    }),
  );
}

test("dashboard renders empty, waiting, and actionable attention states without hiding rows", () => {
  const empty = render([]);
  assert.match(empty, /Nothing needs you right now\./);
  assert.doesNotMatch(empty, /Needs your attention/);

  const waitingAgreement = agreement("COLLABORATOR");
  const waiting = render([waitingAgreement]);
  assert.match(waiting, /Needs your attention/);
  assert.match(waiting, /Waiting on others/);
  assert.match(waiting, /Waiting for the organizer to switch it on/);
  assert.doesNotMatch(waiting, /Nothing needs you right now\./);

  const actionableAgreement = agreement();
  actionableAgreement.value.versions[0].approvals = {};
  const actionable = render([actionableAgreement]);
  assert.match(actionable, /Approve the split/);
  assert.match(actionable, /Riley has not approved/);
  assert.match(actionable, /Send reminder/);
  assert.doesNotMatch(actionable, /Nothing needs you right now\./);
});
