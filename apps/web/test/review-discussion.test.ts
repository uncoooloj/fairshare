import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRemind,
  commentPayload,
  reminderNotice,
  discussionVersion,
  discussionThreads,
  CommentTopic,
  CommentThread,
  ChangeRoute,
  changeRoute,
  commentCountHint,
  composerTopics,
  filterTopics,
  mergeComments,
  topicLabel,
  type CommentPage,
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
  assert.deepEqual(commentPayload(" hello ", CommentTopic.FEES), {
    body: "hello",
    ruleKey: CommentTopic.FEES,
  });
  assert.throws(() => commentPayload(" ", CommentTopic.FEES));
  assert.throws(() => commentPayload("x".repeat(2001), CommentTopic.FEES));
  assert.equal(
    commentPayload("x".repeat(2000), CommentTopic.SOURCE).body.length,
    2000,
  );
});
test("replies inherit rule scope and prohibit nested replies", () => {
  const parent = {
    id: "root",
    parentId: null,
    ruleKey: CommentTopic.SPLIT,
  } as ReviewComment;
  assert.deepEqual(commentPayload("reply", CommentTopic.FEES, parent), {
    body: "reply",
    ruleKey: CommentTopic.SPLIT,
    parentId: "root",
  });
  assert.throws(() =>
    commentPayload("reply", CommentTopic.FEES, {
      ...parent,
      parentId: "another",
    }),
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

test("historical discussion chooses exact version, not current rules; missing ID falls back safely", () => {
  const amended = {
    ...agreement,
    value: {
      ...agreement.value,
      versions: [version, { ...version, id: 2, status: "DRAFT" }],
    },
  };
  assert.equal(discussionVersion(amended, 1)?.id, 1);
  assert.equal(discussionVersion(amended, 2)?.id, 2);
  assert.equal(discussionVersion(amended, 9)?.id, 2);
  assert.equal(
    discussionVersion(
      { ...agreement, value: { ...agreement.value, versions: [] } },
      1,
    ),
    undefined,
  );
});
test("topic filter preserves complete scoped threads and rejects mismatched replies", () => {
  const root = {
    id: "r",
    parentId: null,
    versionId: 1,
    ruleKey: CommentTopic.SOURCE,
  } as ReviewComment;
  const reply = { ...root, id: "reply", parentId: "r" };
  const split = {
    ...root,
    id: "s",
    ruleKey: CommentTopic.SPLIT,
  } as ReviewComment;
  const rows = [
    root,
    reply,
    split,
    { ...reply, id: "wrong-rule", ruleKey: CommentTopic.FEES } as ReviewComment,
    { ...reply, id: "wrong-version", versionId: 2 },
  ];
  assert.deepEqual(discussionThreads(rows, CommentTopic.SOURCE), [
    { root, replies: [reply] },
  ]);
  assert.equal(discussionThreads(rows, null).length, 2);
  assert.deepEqual(discussionThreads(rows, CommentTopic.FEES), []);
});

test("topic values match what the comments API accepts", () => {
  assert.deepEqual(Object.values(CommentTopic), [
    "AGREEMENT",
    "SPLIT",
    "FEES",
    "ADVANCE",
    "SOURCE",
  ]);
});
test("character count appears only near the limit", () => {
  assert.equal(commentCountHint(0), "");
  assert.equal(commentCountHint(1799), "");
  assert.equal(commentCountHint(1800), "1,800/2,000");
});
test("clause labels name the chips and the composer always offers General", () => {
  const clauses = [
    { id: CommentTopic.SPLIT, label: "4.2 Split" },
    { id: CommentTopic.SPLIT, label: "duplicate" },
    { id: CommentTopic.ADVANCE, label: "4.1 Advance" },
  ];
  assert.equal(topicLabel(CommentTopic.SPLIT, clauses), "4.2 Split");
  assert.equal(topicLabel(CommentTopic.FEES, clauses), "Fees");
  assert.deepEqual(
    composerTopics(clauses).map((t) => t.id),
    [CommentTopic.SPLIT, CommentTopic.ADVANCE, CommentTopic.AGREEMENT],
  );
  assert.equal(composerTopics().length, 5);
});
test("filter chips need three comments across more than one topic", () => {
  const c = (
    id: string,
    ruleKey: CommentTopic,
    parentId: string | null = null,
  ) => ({ id, ruleKey, parentId }) as ReviewComment;
  assert.deepEqual(
    filterTopics([c("a", CommentTopic.SPLIT), c("b", CommentTopic.FEES)]),
    [],
  );
  assert.deepEqual(
    filterTopics([
      c("a", CommentTopic.SPLIT),
      c("b", CommentTopic.SPLIT),
      c("r", CommentTopic.SPLIT, "a"),
    ]),
    [],
  );
  assert.deepEqual(
    filterTopics([
      c("a", CommentTopic.SPLIT),
      c("b", CommentTopic.FEES),
      c("r", CommentTopic.SPLIT, "a"),
    ]),
    [
      { topic: CommentTopic.SPLIT, count: 1 },
      { topic: CommentTopic.FEES, count: 1 },
    ],
  );
});
test("the change hint routes organizers and collaborators differently", () => {
  assert.equal(changeRoute(agreement, "owner"), ChangeRoute.CHANGE_AGREEMENT);
  assert.equal(changeRoute(agreement, "person"), ChangeRoute.SOMETHING_WRONG);
  assert.equal(changeRoute(agreement, "outsider"), undefined);
  assert.equal(changeRoute(agreement), undefined);
});
test("a shared thread loads once, refreshes after the last comment, and posts once at a time", async () => {
  const row = (id: string, sequence: number) =>
    ({
      id,
      sequence,
      ruleKey: CommentTopic.SPLIT,
      parentId: null,
    }) as ReviewComment;
  const calls: string[] = [];
  let pages: CommentPage[] = [
    { comments: [row("a", 1)], nextCursor: null },
    { comments: [row("b", 2)], nextCursor: null },
  ];
  let release: () => void = () => {};
  const fetcher = async <T>(path: string, method = "GET"): Promise<T> => {
    calls.push(`${method} ${path}`);
    if (method === "POST") {
      await new Promise<void>((resolve) => (release = resolve));
      return {} as T;
    }
    return pages.shift() as T;
  };
  const thread = new CommentThread("x/comments", fetcher);
  await thread.load();
  assert.deepEqual(
    thread.state.comments.map((c) => c.id),
    ["a"],
  );
  const first = thread.post("hi", CommentTopic.SPLIT);
  assert.equal(await thread.post("again", CommentTopic.SPLIT), false);
  release();
  assert.equal(await first, true);
  assert.deepEqual(calls, [
    "GET x/comments",
    "POST x/comments",
    "GET x/comments?after=1",
  ]);
  assert.deepEqual(
    thread.state.comments.map((c) => c.id),
    ["a", "b"],
  );
  pages = [];
  assert.deepEqual(
    mergeComments([row("a", 1)], [row("a", 1), row("c", 3)]).map((c) => c.id),
    ["a", "c"],
  );
});
test("a shared thread merges every cursor page so later rule comments remain reachable", async () => {
  const row = (id: string, sequence: number) =>
    ({
      id,
      sequence,
      ruleKey: CommentTopic.FEES,
      parentId: null,
    }) as ReviewComment;
  const pages: CommentPage[] = [
    { comments: [row("oldest", 1)], nextCursor: "1" },
    { comments: [row("later", 2)], nextCursor: null },
  ];
  const calls: string[] = [];
  const thread = new CommentThread("comments", async <T>(path: string) => {
    calls.push(path);
    return pages.shift() as T;
  });
  await thread.load();
  await thread.load(thread.state.cursor!);
  assert.deepEqual(
    thread.state.comments.map((comment) => comment.id),
    ["oldest", "later"],
  );
  assert.deepEqual(calls, ["comments", "comments?after=1"]);
  assert.equal(thread.state.cursor, null);
});
test("thread-owned drafts survive a collapsed view and clear after a successful post", async () => {
  const parent = {
    id: "root",
    ruleKey: CommentTopic.SPLIT,
    parentId: null,
  } as ReviewComment;
  const thread = new CommentThread(
    "comments",
    async <T>(_path: string) => ({ comments: [], nextCursor: null }) as T,
  );
  thread.setDraft(CommentTopic.SPLIT, { body: "Keep this", parent });
  assert.deepEqual(thread.draft(CommentTopic.SPLIT), {
    body: "Keep this",
    parent,
  });
  await thread.post("Keep this", CommentTopic.SPLIT, parent);
  assert.deepEqual(thread.draft(CommentTopic.SPLIT), { body: "" });
});
test("a completed post cannot clear text entered after its request started", async () => {
  let release: () => void = () => {};
  const thread = new CommentThread(
    "comments",
    async <T>(_path: string, method?: string) => {
      if (method === "POST")
        await new Promise<void>((resolve) => (release = resolve));
      return { comments: [], nextCursor: null } as T;
    },
  );
  thread.setDraft(CommentTopic.SPLIT, { body: "First comment" });
  const post = thread.post("First comment", CommentTopic.SPLIT);
  thread.setDraft(CommentTopic.SPLIT, { body: "Newer draft" });
  release();
  assert.equal(await post, true);
  assert.equal(thread.draft(CommentTopic.SPLIT).body, "Newer draft");
});
test("thread-owned drafts never cross version endpoints or rule topics", () => {
  const fetcher = async <T>() => ({ comments: [], nextCursor: null }) as T;
  const first = new CommentThread("agreements/a/versions/1/comments", fetcher);
  const second = new CommentThread("agreements/b/versions/2/comments", fetcher);
  first.setDraft(CommentTopic.FEES, { body: "Fees only" });
  assert.equal(first.draft(CommentTopic.FEES).body, "Fees only");
  assert.equal(first.draft(CommentTopic.SPLIT).body, "");
  assert.equal(second.draft(CommentTopic.FEES).body, "");
});
test("background refresh failures stay quiet; visible loads report errors", async () => {
  const thread = new CommentThread("y", async () => {
    throw new Error("offline");
  });
  await thread.load();
  assert.equal(thread.state.error, "offline");
  thread.state = { ...thread.state, error: "", loaded: true };
  await thread.refresh();
  assert.equal(thread.state.error, "");
});
