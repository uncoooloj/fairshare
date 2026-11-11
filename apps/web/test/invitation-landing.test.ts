import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agreementEmptyState } from "../lib/agreement-empty-state";
import { appSource } from "./app-source";

test("joined members wait for an agreement rather than re-uploading the source", () => {
  const state = agreementEmptyState("MEMBER");
  assert.equal(state.title, "No agreements shared with you yet");
  assert.match(state.description, /organizer to add you/);
  assert.match(state.description, /refresh/);
  assert.doesNotMatch(state.description, /upload/i);
});
test("owners retain creation guidance and viewers get role-appropriate access guidance", () => {
  assert.match(agreementEmptyState("OWNER").description, /Create an agreement/);
  assert.match(
    agreementEmptyState("VIEWER").description,
    /view but not approve/,
  );
  assert.match(
    agreementEmptyState("VIEWER").description,
    /whoever invited you/,
  );
});
test("invitation confirmation suppresses competing application forms; creation respects membership", () => {
  const source = appSource();
  assert.match(source, /flowToken\s*&&\s*flowKind\s*===\s*"\/invitation"/);
  assert.match(source, /isInvitationFlow\s*\?\s*null\s*:\s*needsWorkspace/);
  assert.match(source, /item.role === "OWNER" \|\| item.role === "MEMBER"/);
  assert.match(
    source,
    /\(creating && \(canCreateAgreement \|\| needsWorkspace\)\)/,
  );
  assert.match(
    source,
    /canCreateAgreement && \(\s*<Button onClick=\{\(\) => setCreating\(true\)\}>/,
  );
  assert.match(
    source,
    /if \(a.workspaceId !== currentWorkspace.current\)\s*commitWorkspace\(a.workspaceId\)/,
  );
  assert.equal(source.match(/workspaceRole=\{workspaceRole\}/g)?.length, 1);
});

test("expired or unwanted invitations can be dismissed without consuming them", () => {
  const prompt = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /onCancel\s*&&/);
  assert.match(prompt, /onClick=\{onCancel\}\s*>\s*Not now/);
  const source = appSource();
  assert.match(
    source,
    /onCancel=\{isInvitationFlow\s*\?\s*dismissAccessFlow\s*:\s*undefined\}/,
  );
  assert.match(
    source,
    /function\s+dismissAccessFlow\s*\(\)\s*\{\s*setFlowToken\(""\);\s*setError\(""\);\s*router\.replace\("\/app"\)/,
  );
});
