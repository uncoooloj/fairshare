import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  blockerMessages,
  owedLines,
  pausedMessage,
  pausedView,
  PausedView,
  ResumeBlocker,
} from "../lib/refund-review";

const state = {
  reviewHold: true,
  owedBack: { riley: 2000, jordan: 0 },
  members: [
    { userId: "maya", displayName: "Maya", role: "ORGANIZER" },
    { userId: "riley", displayName: "Riley", role: "COLLABORATOR" },
    { userId: "jordan", displayName: "Jordan", role: "COLLABORATOR" },
  ],
};

test("the organizer reviews; collaborators see who is reviewing", () => {
  assert.equal(pausedView(state, "maya"), PausedView.ORGANIZER);
  assert.equal(
    pausedMessage(PausedView.ORGANIZER, state),
    "Payouts are paused after a refund",
  );
  assert.equal(pausedView(state, "riley"), PausedView.COLLABORATOR);
  assert.equal(
    pausedMessage(PausedView.COLLABORATOR, state),
    "Payouts are paused while Maya reviews a refund.",
  );
  assert.equal(
    pausedView({ ...state, reviewHold: false }, "maya"),
    PausedView.NONE,
  );
});

test("only people who were paid more than the refund left them are listed", () => {
  assert.deepEqual(owedLines(state), [
    { userId: "riley", name: "Riley", cents: 2000 },
  ]);
  assert.deepEqual(owedLines({ ...state, owedBack: undefined }), []);
});

test("resume blockers read as plain sentences, including unknown ones", () => {
  const [dispute, unknown] = blockerMessages([
    ResumeBlocker.DISPUTE_OPEN,
    "SOMETHING_NEW",
  ]);
  assert.match(dispute, /dispute is still open/);
  assert.match(unknown, /needs checking/);
});

test("copy avoids engine words", async () => {
  for (const file of [
    "../components/refund-paused-banner.tsx",
    "../lib/refund-review.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const visible = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(
      visible,
      />[^<{]*\b(allocation|recoup|basis points|activate)/i,
    );
  }
});

test("the pause review is mounted above agreement tabs with its recovery endpoint", async () => {
  const source = await readFile(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<RefundPausedBanner[\s\S]*base=\{base\}[\s\S]*refresh=\{refresh\}/,
  );
  assert.ok(
    source.indexOf("<RefundPausedBanner") < source.indexOf("<AgreementTabs"),
  );
});
