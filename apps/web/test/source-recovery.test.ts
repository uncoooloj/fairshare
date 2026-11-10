import test from "node:test";
import assert from "node:assert/strict";
import { recoverSourceDocument } from "../lib/source-recovery";

test("draft recovers newest source and saved extraction after reload", async () => {
  const calls: string[] = [];
  const doc = { documentId: "latest", text: "Exact uploaded text", extraction: { facts: [] } };
  const result = await recoverSourceDocument("agreement", undefined, async path => {
    calls.push(path);
    return path.endsWith("/documents") ? { documents: [{ documentId: "latest" }, { documentId: "older" }], nextCursor: null } : doc;
  });
  assert.deepEqual(result, doc);
  assert.deepEqual(calls, ["agreement/documents", "agreement/documents/latest"]);
});
test("proposal remains pinned to its own source without consulting newer uploads", async () => {
  const calls: string[] = [];
  await recoverSourceDocument("agreement", "approved-source", async path => { calls.push(path); return {}; });
  assert.deepEqual(calls, ["agreement/documents/approved-source"]);
});
test("empty history stays empty and authorization failures propagate", async () => {
  assert.equal(await recoverSourceDocument("agreement", undefined, async () => ({ documents: [] })), null);
  await assert.rejects(recoverSourceDocument("agreement", undefined, async () => { throw new Error("Forbidden"); }), /Forbidden/);
});
