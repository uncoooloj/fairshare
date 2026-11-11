import type { Agreement, Version } from "./model";

/** The rule a comment is about. Values are the `ruleKey`s the comments API accepts. */
export enum CommentTopic {
  AGREEMENT = "AGREEMENT",
  SPLIT = "SPLIT",
  FEES = "FEES",
  ADVANCE = "ADVANCE",
  SOURCE = "SOURCE",
}
/** Short chip labels; a layout that knows its clauses can pass its own. */
export const discussionTopics: Record<CommentTopic, string> = {
  [CommentTopic.AGREEMENT]: "General",
  [CommentTopic.SPLIT]: "Split",
  [CommentTopic.FEES]: "Fees",
  [CommentTopic.ADVANCE]: "Advance",
  [CommentTopic.SOURCE]: "Document",
};
/** @deprecated Use CommentTopic. Kept so older imports keep compiling. */
export type Topic = CommentTopic;
export const COMMENT_LIMIT = 2000;
/** Show the character count only once a comment gets close to the limit. */
export const COMMENT_COUNT_FROM = 1800;
/** Quiet background refresh while the page is visible. */
export const COMMENT_POLL_MS = 30_000;

export interface ReviewComment {
  id: string;
  versionId: number;
  ruleKey: CommentTopic;
  parentId: string | null;
  authorId: string;
  body: string;
  createdAt: number;
  /** Server order; the cursor for fetching newer comments. */
  sequence?: number;
}
export interface CommentPage {
  comments: ReviewComment[];
  nextCursor: string | null;
}
export interface DiscussionClause {
  id: CommentTopic;
  label: string;
}

export function commentPayload(
  body: string,
  ruleKey: CommentTopic,
  parent?: ReviewComment,
) {
  const text = body.trim();
  if (!text || text.length > COMMENT_LIMIT)
    throw new Error("Write a comment between 1 and 2,000 characters.");
  if (parent?.parentId)
    throw new Error("Reply to the original comment instead.");
  return {
    body: text,
    ruleKey: parent?.ruleKey ?? ruleKey,
    ...(parent ? { parentId: parent.id } : {}),
  };
}
export function commentCountHint(length: number) {
  return length >= COMMENT_COUNT_FROM
    ? `${length.toLocaleString("en-US")}/2,000`
    : "";
}
/** Label for a topic, preferring the clause label the layout passed in. */
export function topicLabel(topic: CommentTopic, clauses?: DiscussionClause[]) {
  return (
    clauses?.find((clause) => clause.id === topic)?.label ??
    discussionTopics[topic]
  );
}
/** Topics a new comment can be about: the layout's clauses, plus "General". */
export function composerTopics(clauses?: DiscussionClause[]) {
  if (!clauses?.length)
    return Object.values(CommentTopic).map((id) => ({
      id,
      label: discussionTopics[id],
    }));
  const list = clauses.filter(
    (clause, index) =>
      clauses.findIndex((other) => other.id === clause.id) === index,
  );
  return list.some((clause) => clause.id === CommentTopic.AGREEMENT)
    ? list
    : [
        ...list,
        {
          id: CommentTopic.AGREEMENT,
          label: discussionTopics[CommentTopic.AGREEMENT],
        },
      ];
}
/** Filter chips appear only once there is enough to filter: 3+ comments. */
export function filterTopics(comments: ReviewComment[]) {
  const roots = comments.filter((comment) => !comment.parentId);
  if (comments.length < 3) return [];
  const counts = new Map<CommentTopic, number>();
  for (const root of roots)
    counts.set(root.ruleKey, (counts.get(root.ruleKey) ?? 0) + 1);
  return counts.size > 1
    ? [...counts].map(([topic, count]) => ({ topic, count }))
    : [];
}

export enum ChangeRoute {
  /** Collaborators raise "Something's not right". */
  SOMETHING_WRONG = "SOMETHING_WRONG",
  /** Organizers open "Change the agreement". */
  CHANGE_AGREEMENT = "CHANGE_AGREEMENT",
}
export function changeRoute(
  agreement: Agreement,
  userId?: string,
): ChangeRoute | undefined {
  const member = agreement.value.members.find((m) => m.userId === userId);
  if (!member) return undefined;
  return member.role === "ORGANIZER"
    ? ChangeRoute.CHANGE_AGREEMENT
    : ChangeRoute.SOMETHING_WRONG;
}
export const changeRouteLabel: Record<ChangeRoute, string> = {
  [ChangeRoute.SOMETHING_WRONG]: "Something’s not right",
  [ChangeRoute.CHANGE_AGREEMENT]: "Change the agreement",
};

export interface ThreadState {
  comments: ReviewComment[];
  cursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string;
}
export interface CommentDraft {
  body: string;
  parent?: ReviewComment;
}
type Fetcher = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

/**
 * One comment list per version, shared by every discussion view on the page so the
 * main thread and the per-clause threads fetch once and stay in step.
 */
export class CommentThread {
  state: ThreadState = {
    comments: [],
    cursor: null,
    loaded: false,
    loading: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private posting = false;
  /** In-memory only: survives a collapsed card without following another version. */
  private drafts = new Map<CommentTopic, CommentDraft>();
  /** Bumps whenever a draft changes, so an older post cannot clear newer typing. */
  private draftVersions = new Map<CommentTopic, number>();
  constructor(
    readonly path: string,
    private readonly fetcher: Fetcher,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get watched() {
    return this.listeners.size > 0;
  }
  getState = () => this.state;
  draft(topic: CommentTopic): CommentDraft {
    return this.drafts.get(topic) ?? { body: "" };
  }
  setDraft(topic: CommentTopic, draft: CommentDraft) {
    this.drafts.set(topic, draft);
    this.draftVersions.set(topic, (this.draftVersions.get(topic) ?? 0) + 1);
    this.set({});
  }
  clearDraft(topic: CommentTopic, expectedVersion?: number) {
    if (
      expectedVersion !== undefined &&
      (this.draftVersions.get(topic) ?? 0) !== expectedVersion
    )
      return;
    if (!this.drafts.delete(topic)) return;
    this.draftVersions.delete(topic);
    this.set({});
  }
  private set(next: Partial<ThreadState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  /** Fetch the first page, or the next one with a cursor. */
  async load(after?: string) {
    const request = ++this.sequence;
    this.set({ loading: true, error: "" });
    try {
      const page = await this.fetcher<CommentPage>(
        this.path + (after ? `?after=${encodeURIComponent(after)}` : ""),
      );
      if (request !== this.sequence) return;
      this.set({
        comments: after
          ? mergeComments(this.state.comments, page.comments)
          : page.comments,
        cursor: page.nextCursor,
        loaded: true,
        loading: false,
      });
    } catch (e) {
      if (request !== this.sequence) return;
      this.set({
        loading: false,
        error: e instanceof Error ? e.message : "Could not load comments.",
      });
    }
  }
  /**
   * Pick up comments posted since the last one we have, without a spinner or error.
   * Skipped while older pages are still unloaded; "Show more" covers those.
   */
  async refresh() {
    if (!this.state.loaded) return this.load();
    if (this.state.cursor || this.state.loading) return;
    const last = this.state.comments.at(-1)?.sequence;
    const request = ++this.sequence;
    try {
      const page = await this.fetcher<CommentPage>(
        this.path + (last ? `?after=${last}` : ""),
      );
      if (request !== this.sequence) return;
      this.set({
        comments: mergeComments(this.state.comments, page.comments),
        cursor: page.nextCursor,
      });
    } catch {
      // A missed background refresh is retried on the next focus or poll.
    }
  }
  /** Post once at a time; resolves true when the comment was saved. */
  async post(body: string, topic: CommentTopic, parent?: ReviewComment) {
    if (this.posting) return false;
    this.posting = true;
    const draftTopic = parent?.ruleKey ?? topic;
    const draftVersion = this.draftVersions.get(draftTopic) ?? 0;
    try {
      await this.fetcher(
        this.path,
        "POST",
        commentPayload(body, topic, parent),
      );
      await this.refresh();
      this.clearDraft(draftTopic, draftVersion);
      return true;
    } finally {
      this.posting = false;
    }
  }
}
/** Append comments not already present, keeping server order. */
export function mergeComments(old: ReviewComment[], next: ReviewComment[]) {
  const seen = new Set(old.map((comment) => comment.id));
  return [...old, ...next.filter((comment) => !seen.has(comment.id))];
}
const threads = new Map<string, CommentThread>();
export function commentThread(path: string, fetcher: Fetcher) {
  let thread = threads.get(path);
  if (!thread) {
    thread = new CommentThread(path, fetcher);
    threads.set(path, thread);
  }
  return thread;
}

export function canRemind(
  agreement: Agreement,
  version: Version,
  userId: string,
  recipientId: string,
) {
  return (
    agreement.value.members.some(
      (m) => m.userId === userId && m.role === "ORGANIZER",
    ) &&
    agreement.value.versions.at(-1)?.id === version.id &&
    version.status === "AWAITING_APPROVAL" &&
    recipientId !== userId &&
    agreement.value.members.some((m) => m.userId === recipientId) &&
    !Object.hasOwn(version.approvals, recipientId)
  );
}
export function reminderNotice(result: { status: string; repeated?: boolean }) {
  const prefix = result.repeated
    ? "A reminder was already attempted in the last 24 hours. No additional email was sent. "
    : "";
  switch (result.status) {
    case "PROVIDER_ACCEPTED":
      return (
        prefix +
        "The email provider accepted the reminder. Inbox delivery is not confirmed."
      );
    case "SENDING":
      return (
        prefix + "The reminder request is still processing. Do not resend."
      );
    default:
      return (
        prefix +
        "Delivery is unconfirmed. Do not resend; another attempt is blocked for 24 hours to avoid duplicates."
      );
  }
}

/** Fall back to the current version if an obsolete selection is no longer present. */
export function discussionVersion(
  agreement: Agreement,
  id: number,
): Version | undefined {
  return (
    agreement.value.versions.find((version) => version.id === id) ??
    agreement.value.versions.at(-1)
  );
}
/** Root comments with their replies; `topic` null means every topic. */
export function discussionThreads(
  comments: ReviewComment[],
  topic: CommentTopic | null,
) {
  return comments
    .filter(
      (comment) =>
        !comment.parentId && (topic === null || comment.ruleKey === topic),
    )
    .map((root) => ({
      root,
      replies: comments.filter(
        (reply) =>
          reply.parentId === root.id &&
          reply.versionId === root.versionId &&
          reply.ruleKey === root.ruleKey,
      ),
    }));
}
