import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorCopy } from "../lib/error-copy";

const app = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);

test("agreement navigation discovers all authorized groups without conflating group and agreement IDs", () => {
  assert.match(app, /api\("workspaces"\)/);
  assert.match(app, /groups.workspaces.map/);
  assert.match(app, /workspaceBase\(group.id\)/);
  assert.match(app, /lists.flatMap/);
  assert.match(
    app,
    /if \(a.workspaceId !== currentWorkspace.current\)\s*commitWorkspace\(a.workspaceId\)/,
  );
  assert.match(app, /workspaceBase\(a.workspaceId\)/);
  assert.match(app, /workspaceBase\(p.agreement.workspaceId\)/);
  assert.match(app, /request !== workspaceRequest.current/);
  assert.doesNotMatch(app, /aria-label="Workspace"|WorkspaceNameForm/);
});

test("legacy tenant errors never expose implementation language", () => {
  assert.doesNotMatch(
    errorCopy(400, "INVALID", "Workspace not found"),
    /workspace/i,
  );
  assert.match(errorCopy(400, "INVALID", "Workspace not found"), /access/);
  assert.equal(
    errorCopy(400, "INVALID", "Enter a valid amount."),
    "Enter a valid amount.",
  );
});

test("generic invitations do not promise agreement participation; scoped ones do", () => {
  assert.match(app, /organizer must still add them to an agreement/);
  const scoped = readFileSync(
    new URL("../components/agreement-invitation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(scoped, /does not grant access to other agreements/);
});
