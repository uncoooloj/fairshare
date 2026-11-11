import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import type { Agreement } from "../lib/model";

// Shared widgets pull in CSS; stub it the same way as app-routes.test.ts (works on Node 22).
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const widgets = () =>
  require("../components/agreement-widgets.tsx") as typeof import("../components/agreement-widgets");

type Person = [id: string, name: string, bp?: number, pending?: boolean];
const agreement = (
  id: string,
  people: Person[],
  opts: { versions?: boolean; revenue?: number[] } = {},
): Agreement =>
  ({
    workspaceId: "w1",
    id,
    revision: 1,
    value: {
      name: `Agreement ${id}`,
      members: people.map(([userId, displayName, , pending], i) => ({
        userId,
        displayName,
        role: i === 0 ? "ORGANIZER" : "MEMBER",
        ...(pending
          ? { pending: { invitationId: userId, email: "x@example.test" } }
          : {}),
      })),
      versions:
        opts.versions === false
          ? []
          : [
              {
                id: 1,
                status: "APPROVED",
                rules: {
                  shares: people
                    .filter(([, , bp]) => bp !== undefined)
                    .map(([userId, , bp]) => ({ userId, basisPoints: bp })),
                },
                approvals: {},
              },
            ],
      activeVersionId: opts.versions === false ? undefined : 1,
      audit: [
        {
          sequence: 1,
          type: "CREATED",
          at: "2026-11-11T10:00:00Z",
          actorId: "a",
        },
      ],
      revenue: (opts.revenue || []).map((grossCents) => ({
        grossCents,
        feeCents: 0,
        netCents: grossCents,
      })),
      reviewHold: false,
    },
  }) as unknown as Agreement;

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const render = (agreements: Agreement[], draftIds: string[] = []) => {
  const { AgreementList } = widgets();
  return renderToStaticMarkup(
    createElement(AgreementList, {
      agreements,
      onOpen: () => {},
      viewerId: "maya",
      isDraft: (a: Agreement) => draftIds.includes(a.id),
    }),
  );
};
const splitOf = (html: string) =>
  text(
    html.slice(
      html.indexOf('<span class="ag-split-text"'),
      html.indexOf('<span class="ag-split-tip"'),
    ),
  );

test("split reads as names and shares, largest first, with the viewer marked", () => {
  const html = render([
    agreement("a", [
      ["riley", "Riley Chen", 2000],
      ["maya", "Maya Okafor", 5000],
      ["jordan", "Jordan Bell", 3000],
    ]),
  ]);
  assert.equal(splitOf(html), "Maya (you) 50 · Jordan 30 · Riley 20");
  assert.match(html, /class="ag-split-you">Maya \(you\) 50/);
  // Thin bar under the text for several people; tooltip lists everyone with percentages.
  assert.match(html, /class="ag-split-bar"/);
  assert.match(html, /role="tooltip"[^>]*>.*Riley Chen.*20%/);
  assert.match(html, /tabindex="0" aria-describedby="split-tip-w1-a"/);
});

test("one person reads 'Betty 100%' with no bar", () => {
  const html = render([agreement("b", [["betty", "Betty Wu", 10000]])]);
  assert.equal(splitOf(html), "Betty 100%");
  assert.doesNotMatch(html, /ag-split-bar/);
});

test("more than three people show the top two and +N; tooltip has all of them", () => {
  const html = render([
    agreement("c", [
      ["maya", "Maya", 4000],
      ["jordan", "Jordan", 2500],
      ["riley", "Riley", 1500],
      ["sam", "Sam", 1000],
      ["kemi", "Kemi", 1000],
    ]),
  ]);
  assert.equal(splitOf(html), "Maya (you) 40 · Jordan 25 +3");
  const tip = text(html.slice(html.indexOf('role="tooltip"')));
  for (const name of ["Riley 15%", "Sam 10%", "Kemi 10%"])
    assert.ok(tip.includes(name), name);
});

test("people who have not joined are muted", () => {
  const html = render([
    agreement("d", [
      ["maya", "Maya", 6000],
      ["pending:inv-1", "Jordan", 4000, true],
    ]),
  ]);
  assert.match(html, /class="ag-split-pending">Jordan 40/);
  assert.match(html, /hasn’t joined yet/);
});

test("drafts and agreements without rules show a dash, no version numbers anywhere", () => {
  const html = render(
    [
      agreement("draft", [["maya", "Maya"]], { versions: false }),
      agreement("norules", [["maya", "Maya"]]),
      agreement("paid", [["maya", "Maya", 10000]], { revenue: [400] }),
      agreement("unpaid", [["maya", "Maya", 10000]]),
    ],
    ["draft"],
  );
  const rows = html.split("<tr").slice(2).map(text);
  assert.match(
    rows[0],
    /Not sent yet .*— No split yet — Nothing received Finish setting up$/,
  );
  assert.match(rows[1], /Approved .* — No split yet/);
  assert.match(rows[2], /\$4$/);
  assert.match(rows[3], /\$0$/);
  for (const row of rows) {
    assert.match(row, /Updated Nov 11/);
    assert.doesNotMatch(row, /\bv\d/);
  }
});

test("people column stacks four avatars with a named +N", () => {
  const people: Person[] = ["Ada", "Bo", "Cy", "Di", "Ed", "Flo"].map((n) => [
    n.toLowerCase(),
    n,
  ]);
  const html = render([agreement("e", people)]);
  assert.match(html, /title="Ed, Flo"[^>]*>\+2</);
  assert.match(html, /title="Ada"/);
});
