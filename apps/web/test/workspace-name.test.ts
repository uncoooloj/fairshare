import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initialWorkspaceName,
  workspaceNameDraft,
} from "../lib/workspace-name";
import { appSource } from "./app-source";

test("workspace rename is initialized to the existing workspace name", () => {
  assert.deepEqual(initialWorkspaceName("Artist collaboration"), {
    draft: "Artist collaboration",
    serverName: "Artist collaboration",
    dirty: false,
  });
});
test("refresh updates untouched name but never discards an unsaved edit", () => {
  const initial = initialWorkspaceName("Original");
  assert.equal(
    workspaceNameDraft(initial, { type: "refresh", name: "Renamed elsewhere" })
      .draft,
    "Renamed elsewhere",
  );
  const edited = workspaceNameDraft(initial, {
    type: "edit",
    name: "My unsaved name",
  });
  const refreshed = workspaceNameDraft(edited, {
    type: "refresh",
    name: "Renamed elsewhere",
  });
  assert.equal(refreshed.draft, "My unsaved name");
  assert.equal(refreshed.serverName, "Renamed elsewhere");
  assert.equal(refreshed.dirty, true);
  assert.equal(
    workspaceNameDraft(edited, { type: "refresh", name: "Original" }).draft,
    "My unsaved name",
  );
});
test("confirmed saved name becomes clean, and returning to server name clears dirty state", () => {
  const edited = workspaceNameDraft(initialWorkspaceName("Old"), {
    type: "edit",
    name: " New name ",
  });
  assert.deepEqual(
    workspaceNameDraft(edited, { type: "refresh", name: "New name" }),
    initialWorkspaceName("New name"),
  );
  assert.equal(
    workspaceNameDraft(edited, { type: "edit", name: "Old" }).dirty,
    false,
  );
});
test("internal group naming is not exposed as agreement settings", () => {
  const app = appSource();
  assert.doesNotMatch(
    app,
    /WorkspaceNameForm|Rename your workspace|<h2>Workspace/,
  );
});
