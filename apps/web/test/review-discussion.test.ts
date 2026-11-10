import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRemind,
  commentPayload,
  reminderNotice,
  type ReviewComment,
} from "../lib/review-discussion";
import type { Agreement, Version } from "../lib/model";
const version = {
  id: 1,
  status: "AWAITING_APPROVAL",
  approvals: {},
} as Version;
const agreement = {
  value: {
    members: [
      { userId: "owner", role: "ORGANIZER" },
      { userId: "person", role: "PARTICIPANT" },
    ],
    versions: [version],
  },
} as Agreement;
test("comments trim and validate limits without changing approvals", () => {
  assert.deepEqual(commentPayload(" hello ", "FEES"), {
    body: "hello",
    ruleKey: "FEES",
  });
  assert.throws(() => commentPayload(" ", "FEES"));
  assert.throws(() => commentPayload("x".repeat(2001), "FEES"));
  assert.equal(commentPayload("x".repeat(2000), "SOURCE").body.length, 2000);
});
test("replies inherit rule scope and prohibit nested replies", () => {
  const parent = {
    id: "root",
    parentId: null,
    ruleKey: "SPLIT",
  } as ReviewComment;
  assert.deepEqual(commentPayload("reply", "FEES", parent), {
    body: "reply",
    ruleKey: "SPLIT",
    parentId: "root",
  });
  assert.throws(() =>
    commentPayload("reply", "FEES", { ...parent, parentId: "another" }),
  );
});
test("reminders only offered to organizer for pending others on latest review", () => {
  assert(canRemind(agreement, version, "owner", "person"));
  assert(!canRemind(agreement, version, "person", "owner"));
  assert(!canRemind(agreement, version, "owner", "owner"));
  assert(!canRemind(agreement, version, "owner", "outsider"));
  assert(
    !canRemind(agreement, { ...version, status: "ACTIVE" }, "owner", "person"),
  );
  assert(
    !canRemind(
      agreement,
      { ...version, approvals: { person: "now" } },
      "owner",
      "person",
    ),
  );
  assert(
    !canRemind(
      {
        ...agreement,
        value: {
          ...agreement.value,
          versions: [version, { ...version, id: 2 }],
        },
      },
      version,
      "owner",
      "person",
    ),
  );
});
test("provider receipt never claims inbox delivery; repeats and uncertain results stay explicit", () => {
  assert.match(
    reminderNotice({ status: "PROVIDER_ACCEPTED" }),
    /delivery is not confirmed/,
  );
  assert.match(
    reminderNotice({ status: "PROVIDER_ACCEPTED", repeated: true }),
    /No additional email/,
  );
  assert.match(reminderNotice({ status: "SENDING" }), /Do not resend/);
  assert.match(reminderNotice({ status: "UNCONFIRMED" }), /24 hours/);
  assert.match(reminderNotice({ status: "unexpected" }), /unconfirmed/);
});
