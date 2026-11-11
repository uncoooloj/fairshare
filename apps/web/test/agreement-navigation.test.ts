import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorCopy } from "../lib/error-copy";
import {
  agreementIdentityKey,
  findAgreementByIdentity,
} from "../lib/agreement-identity";
import { appSource } from "./app-source";

const app = appSource();

const search = readFileSync(
  new URL("../components/global-search.tsx", import.meta.url),
  "utf8",
);

test("agreement navigation discovers all authorized groups without conflating group and agreement IDs", () => {
  assert.match(app, /api\("workspaces"\)/);
  assert.match(app, /groups.workspaces.map/);
  assert.match(app, /workspaceBase\(group.id\)/);
  assert.match(app, /lists.flatMap/);
  // Top-bar search opens the agreement object itself; results are keyed by full identity.
  assert.match(search, /agreementIdentityKey\(agreement\)/);
  assert.match(search, /onOpen\(result\.agreement\)/);
  assert.match(app, /<GlobalSearch[\s\S]*?openAgreement\(agreement\)/);
  assert.match(
    app,
    /if \(a.workspaceId !== currentWorkspace.current\)\s*commitWorkspace\(a.workspaceId\)/,
  );
  assert.match(app, /workspaceBase\(a.workspaceId\)/);
  assert.match(app, /workspaceBase\(p.agreement.workspaceId\)/);
  assert.match(app, /request !== workspaceRequest.current/);
  assert.doesNotMatch(app, /aria-label="Workspace"|WorkspaceNameForm/);
});

test("agreement identity keeps same agreement IDs in separate workspaces distinct", () => {
  const first = { workspaceId: "workspace-a", id: "agreement" };
  const second = { workspaceId: "workspace-b", id: "agreement" };
  const secondKey = agreementIdentityKey(second);
  assert.notEqual(agreementIdentityKey(first), secondKey);
  assert.equal(findAgreementByIdentity([first, second], secondKey), second);
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
