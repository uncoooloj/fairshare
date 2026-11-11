import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AgreementCreationWizard,
  CreationStepper,
  creationSteps,
} from "../components/agreement-creation-wizard";
import type { Agreement } from "../lib/model";

test("v2 creation has one ordered upload-first stepper, not agreement tabs", () => {
  assert.deepEqual(creationSteps, ["Document", "Details", "People", "Review"]);
  const html = renderToStaticMarkup(
    createElement(CreationStepper, { step: 1, onStep: () => {} }),
  );
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /New agreement progress/);
  assert.match(html, /disabled=""[^>]*>.*People/);
  assert.doesNotMatch(html, /role="tab"/);
});

test("after upload details show inferred editable name and real supported currency", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementCreationWizard, {
      agreement: {
        id: "a1",
        value: { name: "Artist Agreement", members: [], versions: [] },
      } as unknown as Agreement,
      source: "Artist Agreement",
      members: [],
      userId: "owner",
      onSaveName: async () => {},
      onAddMember: async () => {},
      onRefresh: async () => {},
      onComplete: () => {},
      onClose: () => {},
      onDirtyChange: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /value="Artist Agreement"/);
  assert.match(html, /USD is currently supported/);
  assert.doesNotMatch(html, /Effective dates|Send for approval|type="file"/);
  assert.match(html, /Save and close/);
});

test("creation saves actual participant and name changes, keeps consent boundary and error recovery", () => {
  const wizard = readFileSync(
    new URL("../components/agreement-creation-wizard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(wizard, /await onSaveName\(name.trim\(\)\)/);
  assert.match(wizard, /onAddMember\(person.id\)/);
  assert.match(wizard, /cause instanceof Error/);
  assert.match(wizard, /Next, choose whether AI may interpret/);
  assert.match(wizard, /Share a private invitation to this agreement/);
  assert.match(
    wizard,
    /onDirtyChange\(name.trim\(\) !== agreement.value.name\)/,
  );
  assert.doesNotMatch(wizard, /fetch\(|consentToCloudflare: true/);
});

test("saved drafts resume creation and finishing routes to actual terms review", () => {
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /sessionStorage.setItem\(\s*`fairshare:creation:/);
  assert.match(app, /sessionStorage.getItem\(`fairshare:creation:/);
  assert.match(app, /sessionStorage.removeItem\(\s*`fairshare:creation:/);
  assert.match(
    app,
    /creationAgreementId === selected.id &&\s*!selected.value.versions.length/,
  );
  assert.match(app, /mutate\("\/members", \{ userId \}\)/);
});

test("document preprocessing participates in the app navigation lock", () => {
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((app.match(/onBusyChange=\{setBusy\}/g) || []).length, 3);
  assert.match(app, /function mayLeaveDraft\(\) \{\s*if \(busy\) return false/);
});
