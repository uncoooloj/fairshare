import test from "node:test";
import assert from "node:assert/strict";
import {
  fullAgreementHistoryState,
  isFullAgreementHistoryState,
} from "../lib/full-agreement-history";
import { AppView, parseAppPath, routeForHistory } from "../lib/app-routes";
import { AgreementTab, Section } from "../lib/model";

test("full agreement history closes on Back and reopens on Forward for the same agreement", () => {
  const reviewerEntry = { nextRouter: { path: "/app" } };
  const fullEntry = fullAgreementHistoryState(
    reviewerEntry,
    "workspace-a",
    "a",
  );

  assert.deepEqual(fullEntry.nextRouter, reviewerEntry.nextRouter);
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "a"),
    true,
  );
  // Back returns to the unmarked reviewer entry; Forward returns to the marker.
  assert.equal(
    isFullAgreementHistoryState(reviewerEntry, "workspace-a", "a"),
    false,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "a"),
    true,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-b", "a"),
    false,
  );
  assert.equal(
    isFullAgreementHistoryState(fullEntry, "workspace-a", "other"),
    false,
  );
});

test("a full-agreement marker restores the document route after agreement detail unmounts", () => {
  const route = parseAppPath(
    "/app/agreements/workspace/workspace-a/agreement/agreement",
  );
  const state = fullAgreementHistoryState({}, "workspace-a", "agreement");
  assert.deepEqual(
    routeForHistory(route, state, {
      workspaceId: "workspace-a",
      id: "agreement",
    }),
    {
      view: AppView.Agreement,
      section: Section.Agreements,
      workspaceId: "workspace-a",
      agreementId: "agreement",
      tab: AgreementTab.Document,
    },
  );
  assert.equal(
    routeForHistory(route, state, {
      workspaceId: "workspace-b",
      id: "agreement",
    }).tab,
    AgreementTab.Terms,
  );
});
