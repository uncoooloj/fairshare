import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, ApiError, type Agreement } from "../lib/model";
import {
  agreementStatus,
  AgreementStage,
  StageAction,
} from "../lib/agreement-status";
import {
  agreementLink,
  forgetStaleInviteTokens,
  issueInviteLink,
  rememberInviteToken,
  knownPersonLink,
  nudgeMessage,
} from "../lib/share-link";
import type { AgreementMember } from "../lib/agreement-api";
import {
  canShareLink,
  NudgeDrawer,
  oldLinkWarning,
} from "../components/person-share";
import { readFileSync } from "node:fs";
import { AgreementPeople } from "../components/agreement-people";
import { AgreementHeader } from "../components/agreement-workspace";

const SENT_AT = "2026-11-09T10:00:00Z";
const NOW = Date.parse("2026-11-11T12:00:00Z");

/** Maya organizes and approved; Jordan joined; Riley is invited and hasn't joined. */
function midnight(): Agreement {
  return {
    workspaceId: "w1",
    id: "a1",
    revision: 4,
    value: {
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya Okafor", role: "ORGANIZER" },
        { userId: "jordan", displayName: "Jordan Reyes", role: "COLLABORATOR" },
        {
          userId: "pending:inv-1",
          displayName: "Riley Chen",
          role: "COLLABORATOR",
          pending: { invitationId: "inv-1", email: "riley@chen.audio" },
        } as AgreementMember,
      ],
      versions: [
        {
          id: 1,
          status: "AWAITING_APPROVAL",
          approvals: { maya: SENT_AT },
          changeRequests: [],
          rules: {
            currency: "USD",
            shares: [],
            feePolicy: "BEFORE_SPLIT",
            source: {
              origin: "DOCUMENT",
              documentId: "d",
              clause: "",
              excerpt: "",
            },
            unresolvedQuestions: [],
          },
        },
      ],
      revenue: [],
      recoupedByAdvance: {},
      reviewHold: false,
      audit: [
        { sequence: 1, type: "SENT_FOR_REVIEW", at: SENT_AT, actorId: "maya" },
      ],
    },
  };
}

const withAdvance = (a: Agreement) => {
  a.value.versions[0].rules.advance = {
    id: "adv-1",
    recipientId: "maya",
    amountCents: 200000,
    verified: false,
    source: a.value.versions[0].rules.source,
  };
  return a;
};

/** Records every request; answers a reissue the way the API does. */
function recordFetch() {
  const calls: { url: string; method: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (method === "POST" && String(url).includes("/invitation")) {
      const next = midnight();
      next.revision = 5;
      const riley = next.value.members[2] as AgreementMember;
      riley.userId = "pending:inv-2";
      riley.pending = { invitationId: "inv-2", email: "riley@chen.audio" };
      return new Response(
        JSON.stringify({
          agreement: next,
          invitation: { id: "inv-2", token: "tok-2", expiresAt: 0 },
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ members: [] }), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("waiting line says who approved, who hasn't joined, when it was sent, and offers Nudge", () => {
  const maya = agreementStatus(midnight(), "maya", NOW);
  assert.equal(maya.stage, AgreementStage.WaitingForOthers);
  assert.equal(
    maya.line,
    "Waiting for Jordan · Riley hasn’t joined yet · sent 2 days ago",
  );
  assert.equal(maya.note, "It switches on by itself once everyone approves.");
  assert.equal(maya.action, StageAction.Nudge);
  const jordan = agreementStatus(midnight(), "jordan", NOW);
  assert.equal(jordan.action, StageAction.Approve);
  const a = midnight();
  a.value.versions[0].approvals.jordan = SENT_AT;
  const after = agreementStatus(a, "maya", NOW);
  assert.equal(
    after.line,
    "Jordan approved · Riley hasn’t joined yet · sent 2 days ago",
  );
  assert.equal(
    agreementStatus(a, "jordan", NOW).action,
    StageAction.None,
    "only the organizer nudges",
  );
});

test("an unconfirmed advance: a note while waiting, then the organizer confirms it", () => {
  const waiting = agreementStatus(withAdvance(midnight()), "jordan", NOW);
  assert.equal(waiting.stage, AgreementStage.WaitingForYou);
  const organizer = agreementStatus(withAdvance(midnight()), "maya", NOW);
  assert.equal(organizer.note, "Your $2,000 advance still needs confirming.");
  const a = withAdvance(midnight());
  a.value.members[2] = {
    userId: "riley",
    displayName: "Riley Chen",
    role: "COLLABORATOR",
  };
  a.value.versions[0].approvals = { maya: SENT_AT, jordan: SENT_AT };
  assert.match(
    agreementStatus(a, "jordan", NOW).note ?? "",
    /^Maya's \$2,000 advance still needs confirming\.$/,
  );
  a.value.versions[0].approvals.riley = SENT_AT;
  a.value.versions[0].rules.advance!.recipientId = "jordan";
  const confirm = agreementStatus(a, "maya", NOW);
  assert.equal(confirm.stage, AgreementStage.AdvanceUnconfirmed);
  assert.equal(
    confirm.line,
    "Everyone approved. Confirm Jordan's $2,000 is paid to switch it on.",
  );
  assert.equal(confirm.action, StageAction.ConfirmAdvance);
  const riley = agreementStatus(a, "riley", NOW);
  assert.equal(riley.line, "Waiting for Jordan's $2,000 to be confirmed.");
  assert.equal(riley.action, StageAction.None);
  assert.equal(
    agreementStatus(a, "jordan", NOW).line,
    "Waiting for your $2,000 to be confirmed.",
  );
});

test("each person gets the right link and message; invite links are the organizer's", () => {
  const a = midnight();
  const [maya, jordan, riley] = a.value.members as AgreementMember[];
  assert.equal(
    agreementLink("a1", "https://fairshare-web.udaleamehoj.workers.dev"),
    "https://usefairshare.app/app/agreements/a1",
  );
  assert.equal(
    knownPersonLink(a, jordan, "http://localhost:3480"),
    "http://localhost:3480/app/agreements/a1",
  );
  assert.equal(
    knownPersonLink(a, riley, "http://localhost:3480"),
    undefined,
    "no invite token on this device yet",
  );
  assert.equal(
    nudgeMessage(jordan, "Midnight Sessions", "https://x/app/agreements/a1"),
    "Hi Jordan, can you review and approve the Midnight Sessions split? https://x/app/agreements/a1",
  );
  assert.match(
    nudgeMessage(riley, "Midnight Sessions"),
    /can you join and approve/,
  );
  assert.equal(canShareLink(riley, "maya", true), true);
  assert.equal(canShareLink(riley, "jordan", false), false);
  assert.equal(canShareLink(jordan, "jordan", false), true);
  assert.equal(canShareLink(maya, "jordan", false), false);
});

test("People tab and status header make no invitation POSTs until a button is pressed", async () => {
  const { calls, restore } = recordFetch();
  try {
    const a = midnight();
    const people = renderToStaticMarkup(
      createElement(AgreementPeople, {
        agreement: a,
        version: a.value.versions[0],
        userId: "maya",
        base: "workspaces/w1/collaborations/a1",
        organizer: true,
      }),
    );
    assert.match(people, /Copy link for Jordan/);
    // No token on this device: an honest "Get a new link", never a silent reissue.
    assert.match(people, /Get a new link for Riley/);
    assert.doesNotMatch(people, /(Copy|Share) link for Riley/);
    assert.match(people, /Hasn’t joined yet/);
    assert.match(people, /1 of 3 approved/);
    assert.doesNotMatch(people, /approved v1|>Refresh<|can’t be added/);
    assert.match(people, /title="Payout emails are private/);
    const header = renderToStaticMarkup(
      createElement(AgreementHeader, {
        agreement: a,
        userId: "maya",
        onStatusAction: () => {},
        onBack: () => {},
        onViewPayouts: () => {},
      }),
    );
    assert.match(header, />Nudge</);
    const drawer = renderToStaticMarkup(
      createElement(NudgeDrawer, {
        agreement: a,
        userId: "maya",
        onClose: () => {},
      }),
    );
    assert.match(
      drawer,
      /Hi Jordan, can you review and approve the Midnight Sessions split\? http/,
    );
    assert.match(drawer, /Get a new link for Riley/);
    assert.doesNotMatch(drawer, /(Copy|Share) message for Riley/);
    const collaborator = renderToStaticMarkup(
      createElement(AgreementPeople, {
        agreement: a,
        version: a.value.versions[0],
        userId: "jordan",
        base: "workspaces/w1/collaborations/a1",
      }),
    );
    assert.match(collaborator, /Copy link for Jordan/);
    assert.doesNotMatch(collaborator, /Copy link for (Riley|Maya)/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      calls.filter((call) => call.method !== "GET"),
      [],
      "rendering never creates or revokes a link",
    );

    // Pressing Copy twice at once, then again: one link, created once.
    const riley = a.value.members[2] as AgreementMember;
    const [first, second] = await Promise.all([
      issueInviteLink(a, riley, "http://localhost:3480"),
      issueInviteLink(a, riley, "http://localhost:3480"),
    ]);
    assert.equal(first.link, second.link);
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    const next = first.agreement;
    assert.equal(
      knownPersonLink(
        next,
        next.value.members[2] as AgreementMember,
        "http://localhost:3480",
      ),
      "http://localhost:3480/invitation#token=agreement%3Atok-2",
      "the next press reuses it",
    );
  } finally {
    restore();
  }
});

test("without a token on this device, a new link needs a confirm first", () => {
  const source = readFileSync(
    new URL("../components/person-share.tsx", import.meta.url),
    "utf8",
  );
  const act = source.split("async function act(")[1].split("\n  }\n")[0];
  assert.doesNotMatch(act, /issueInviteLink/, "Copy and Share never reissue");
  assert.match(act, /if \(busy \|\| !known\) return;/);
  const confirm = source
    .split("async function getNewLink(")[1]
    .split("\n  }\n")[0];
  assert.match(confirm, /issueInviteLink\(/);
  assert.match(source, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(source, /onClick=\{\(\) => void getNewLink\(\)\}/);
  const riley = midnight().value.members[2] as AgreementMember;
  assert.equal(
    oldLinkWarning(riley),
    "Riley’s old link will stop working if you already sent it.",
  );
});

test("a known token gives Copy and Share; it is dropped once the person joins", () => {
  const a = midnight();
  a.id = "a-known";
  rememberInviteToken("w1", "a-known", "inv-1", "tok-1");
  rememberInviteToken("w1", "a-known", "inv-old", "tok-old");
  const riley = a.value.members[2] as AgreementMember;
  const html = renderToStaticMarkup(
    createElement(NudgeDrawer, {
      agreement: a,
      userId: "maya",
      onClose: () => {},
    }),
  );
  assert.match(html, /Copy message for Riley/);
  assert.match(html, /token=agreement%3Atok-1/);
  forgetStaleInviteTokens(a);
  assert.match(
    knownPersonLink(a, riley, "http://x") ?? "",
    /tok-1/,
    "still pending",
  );
  const joined = structuredClone(a);
  joined.value.members[2] = {
    userId: "riley",
    displayName: "Riley Chen",
    role: "COLLABORATOR",
  };
  forgetStaleInviteTokens(joined);
  assert.equal(knownPersonLink(a, riley, "http://x"), undefined, "token gone");
});

test("reissue and advance confirmation recover a revision conflict without retrying", () => {
  const people = readFileSync(
    new URL("../components/agreement-people.tsx", import.meta.url),
    "utf8",
  );
  const personShare = readFileSync(
    new URL("../components/person-share.tsx", import.meta.url),
    "utf8",
  );
  const header = readFileSync(
    new URL("../components/agreement-workspace.tsx", import.meta.url),
    "utf8",
  );
  for (const source of [people, personShare, header]) {
    assert.match(
      source,
      /cause instanceof ApiError && cause.code === "REVISION_CONFLICT"/,
    );
    assert.match(
      source,
      /Someone else just changed this\. Here’s the latest; try again\./,
    );
    assert.match(source, /api<Agreement>\(/);
  }
  const reissue = people
    .split("async function makeNewLink(")[1]
    .split("finally")[0];
  assert.equal((reissue.match(/issueInviteLink\(/g) || []).length, 1);
  const personReissue = personShare
    .split("async function getNewLink(")[1]
    .split("finally")[0];
  assert.equal((personReissue.match(/issueInviteLink\(/g) || []).length, 1);
});

test("a failed latest-agreement read keeps the retry error", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (method === "POST")
      return new Response(
        JSON.stringify({
          error: { code: "REVISION_CONFLICT", message: "Reload latest" },
        }),
        { status: 409 },
      );
    return new Response(
      JSON.stringify({ error: { code: "TEMPORARY_FAILURE" } }),
      { status: 503 },
    );
  }) as typeof fetch;
  try {
    const a = midnight();
    const riley = a.value.members[2] as AgreementMember;
    await assert.rejects(
      issueInviteLink(a, riley, "http://localhost:3480"),
      (cause: unknown) =>
        cause instanceof ApiError && cause.code === "REVISION_CONFLICT",
    );
    await assert.rejects(
      api<Agreement>("workspaces/w1/collaborations/a1"),
      (cause: unknown) => cause instanceof ApiError && cause.status === 503,
    );
    assert.deepEqual(
      calls.map((call) => call.split(" ")[0]),
      ["POST", "GET"],
    );
    for (const path of [
      "../components/agreement-people.tsx",
      "../components/person-share.tsx",
      "../components/agreement-workspace.tsx",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      assert.match(source, /refreshFailed/);
      assert.match(
        source,
        /Couldn’t load the latest agreement\. Reload and try again\./,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("the agreement header prunes invite tokens after a fresh agreement revision", () => {
  const source = readFileSync(
    new URL("../components/agreement-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*forgetStaleInviteTokens\(agreement\);\s*\}, \[agreement\.workspaceId, agreement\.id, agreement\.revision\]\)/,
  );
});
