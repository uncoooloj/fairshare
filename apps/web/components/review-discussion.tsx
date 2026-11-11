"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type Agreement, type Version } from "../lib/model";
import {
  COMMENT_LIMIT,
  COMMENT_POLL_MS,
  CommentTopic,
  canRemind,
  changeRoute,
  changeRouteLabel,
  commentCountHint,
  commentThread,
  composerTopics,
  discussionThreads,
  discussionVersion,
  filterTopics,
  topicLabel,
  type CommentThread,
  type DiscussionClause,
  type ReviewComment,
  type ThreadState,
} from "../lib/review-discussion";
import { Button, Notice } from "./ui";
import { Avatar, AvatarSize } from "./person";
import { toneInRoster } from "../lib/person";
import { termsLabel } from "../lib/version-summary";
import { formatExact, formatWhen } from "../lib/dates";
import { workspaceBase } from "../lib/workspace-base";
import { publicWebOrigin } from "../lib/public-web-origin";

export { CommentTopic, type DiscussionClause };

/** Props shared by every discussion view. Only `agreement` and `version` are required. */
interface CommentsBaseProps {
  agreement: Agreement;
  /** The terms being discussed, normally the latest. */
  version: Version;
  /** API base for the agreement; derived from the agreement when omitted. */
  base?: string;
  /** False for read-only workspace members. The API enforces this too. */
  canWrite?: boolean;
  /** Told when an unsent comment exists, so the page can warn before leaving. */
  onDirtyChange?: (dirty: boolean) => void;
}
export interface ReviewDiscussionProps extends CommentsBaseProps {
  /** Show and post only this topic (no chips, no topic picker). */
  topic?: CommentTopic;
  /** Clauses on screen. Their labels name the topic chips; ids are API topics. */
  clauses?: DiscussionClause[];
  /** No heading or terms picker: for a side panel or under a card. */
  compact?: boolean;
  /** Comments on this version, replies included. */
  onCommentCountChange?: (count: number) => void;
  /** The signed-in user; decides which change route the hint names. */
  userId?: string;
  /** Opens "Something's not right" (collaborator) or "Change the agreement" (organizer). */
  onRequestChange?: () => void;
}

function threadPath(props: CommentsBaseProps, versionId: number) {
  const base =
    props.base ??
    `${workspaceBase(props.agreement.workspaceId)}/collaborations/${props.agreement.id}`;
  return `${base}/versions/${versionId}/comments`;
}

/** One background refresher per thread however many views show it. */
const watchers = new Map<CommentThread, { count: number; stop: () => void }>();
function watch(thread: CommentThread) {
  const current = watchers.get(thread);
  if (current) current.count++;
  else {
    const refresh = () => {
      if (document.visibilityState === "visible") void thread.refresh();
    };
    const timer = window.setInterval(refresh, COMMENT_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    watchers.set(thread, {
      count: 1,
      stop: () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      },
    });
  }
  return () => {
    const entry = watchers.get(thread);
    if (!entry || --entry.count > 0) return;
    entry.stop();
    watchers.delete(thread);
  };
}

function useThread(path: string): [CommentThread, ThreadState] {
  const thread = useMemo(() => commentThread(path, api), [path]);
  const state = useSyncExternalStore(
    thread.subscribe,
    thread.getState,
    thread.getState,
  );
  useEffect(() => {
    if (thread.state.loaded) void thread.refresh();
    else if (!thread.state.loading) void thread.load();
    return watch(thread);
  }, [thread]);
  return [thread, state];
}

/**
 * The agreement's comments as one quiet thread: a list, a single composer, and the
 * topic as a chip. Comments never change the terms; the hint points to the route that does.
 */
export function ReviewDiscussion(props: ReviewDiscussionProps) {
  const [versionId, setVersionId] = useState(props.version.id),
    [posting, setPosting] = useState(false);
  const dirty = useRef(false);
  const version = discussionVersion(props.agreement, versionId);
  const { onDirtyChange } = props;
  const reportDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );
  if (!version) return null;
  const latest = version.id === props.version.id;
  const route = changeRoute(props.agreement, props.userId);
  const older = props.agreement.value.versions.length > 1 && !props.compact;
  return (
    <section
      className={`rd-discussion ${props.compact ? "rd-compact" : ""}`}
      aria-label={`Comments on ${termsLabel(version.id).toLowerCase()}`}
    >
      {!props.compact && (
        <div className="rd-head">
          <h3>Comments</h3>
          {older && (
            <select
              className="rd-chip-select"
              aria-label="Showing comments for"
              disabled={posting}
              value={version.id}
              onChange={(event) => {
                if (
                  dirty.current &&
                  !window.confirm(
                    "Discard your unsaved comment and view other terms?",
                  )
                )
                  return;
                reportDirty(false);
                setVersionId(Number(event.target.value));
              }}
            >
              {[...props.agreement.value.versions].reverse().map((item) => (
                <option key={item.id} value={item.id}>
                  {termsLabel(item.id)}
                  {item.id === props.version.id ? " · latest" : " (older)"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <p className="rd-hint">
        Comments don’t change the split.{" "}
        {route ? (
          <>
            To change it, use{" "}
            {props.onRequestChange ? (
              <button
                type="button"
                className="rd-link"
                onClick={props.onRequestChange}
              >
                {changeRouteLabel[route]}
              </button>
            ) : (
              <strong>{changeRouteLabel[route]}</strong>
            )}
            .
          </>
        ) : null}
      </p>
      {!latest && (
        <p className="rd-hint">
          These are comments on {termsLabel(version.id).toLowerCase()}. Switch
          to the latest terms to reply.
        </p>
      )}
      <VersionThread
        key={`${props.agreement.id}:${version.id}`}
        {...props}
        version={version}
        canWrite={(props.canWrite ?? true) && latest}
        onDirtyChange={reportDirty}
        onPostingChange={setPosting}
      />
    </section>
  );
}

function VersionThread(
  props: ReviewDiscussionProps & {
    onDirtyChange: (dirty: boolean) => void;
    onPostingChange: (posting: boolean) => void;
  },
) {
  const { agreement, version, clauses, onCommentCountChange } = props;
  const [thread, state] = useThread(threadPath(props, version.id));
  const [filter, setFilter] = useState<CommentTopic | null>(null),
    [parent, setParent] = useState<ReviewComment>();
  const fixed = props.topic;
  const count = fixed
    ? state.comments.filter((comment) => comment.ruleKey === fixed).length
    : state.comments.length;
  useEffect(() => {
    if (state.loaded) onCommentCountChange?.(count);
  }, [count, state.loaded, onCommentCountChange]);
  const chips = fixed ? [] : filterTopics(state.comments);
  const active =
    fixed ?? (chips.some((chip) => chip.topic === filter) ? filter : null);
  const threads = discussionThreads(state.comments, active);
  const writable = props.canWrite !== false && version.status !== "SUPERSEDED";
  return (
    <>
      {chips.length > 0 && (
        <div className="rd-chips" role="group" aria-label="Show comments">
          <button
            type="button"
            className="rd-chip"
            aria-pressed={active === null}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {chips.map((chip) => (
            <button
              key={chip.topic}
              type="button"
              className="rd-chip"
              aria-pressed={active === chip.topic}
              onClick={() => setFilter(chip.topic)}
            >
              {topicLabel(chip.topic, clauses)}
              <span className="rd-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
      )}
      <CommentList
        agreement={agreement}
        clauses={clauses}
        threads={threads}
        showTopic={!fixed}
        onReply={
          writable
            ? (comment) => {
                setParent(comment);
              }
            : undefined
        }
      />
      {state.loading && !state.loaded && (
        <p className="rd-quiet" role="status">
          Loading comments…
        </p>
      )}
      {state.loaded && !count && !state.error && (
        <p className="rd-quiet">No comments yet.</p>
      )}
      {state.cursor && (
        <button
          type="button"
          className="rd-link"
          disabled={state.loading}
          onClick={() => void thread.load(state.cursor!)}
        >
          Show more comments
        </button>
      )}
      {state.error && (
        <div role="alert">
          <Notice warning>{state.error}</Notice>
        </div>
      )}
      {writable && (
        <Composer
          thread={thread}
          topics={composerTopics(clauses)}
          fixedTopic={fixed}
          parent={parent}
          parentName={parent ? memberName(agreement, parent.authorId) : ""}
          onCancelReply={() => setParent(undefined)}
          onPosted={() => setParent(undefined)}
          onDirtyChange={props.onDirtyChange}
          onPostingChange={props.onPostingChange}
        />
      )}
    </>
  );
}

function memberName(agreement: Agreement, userId: string) {
  return (
    agreement.value.members.find((m) => m.userId === userId)?.displayName ??
    "Participant"
  );
}

function CommentList({
  agreement,
  clauses,
  threads,
  showTopic,
  onReply,
}: {
  agreement: Agreement;
  clauses?: DiscussionClause[];
  threads: ReturnType<typeof discussionThreads>;
  showTopic: boolean;
  onReply?: (comment: ReviewComment) => void;
}) {
  if (!threads.length) return null;
  const item = (comment: ReviewComment) => {
    const name = memberName(agreement, comment.authorId);
    return (
      <li key={comment.id} className="rd-comment">
        <Avatar
          name={name}
          tone={toneInRoster(comment.authorId, agreement.value.members)}
          size={AvatarSize.SMALL}
          label={false}
        />
        <div className="rd-comment-body">
          <p className="rd-meta">
            <strong>{name}</strong>
            <span aria-hidden="true"> · </span>
            <time
              dateTime={new Date(comment.createdAt).toISOString()}
              title={formatExact(comment.createdAt)}
            >
              {formatWhen(comment.createdAt)}
            </time>
            {showTopic && !comment.parentId && (
              <span className="rd-tag">
                {topicLabel(comment.ruleKey, clauses)}
              </span>
            )}
          </p>
          <p className="rd-text">{comment.body}</p>
          {onReply && !comment.parentId && (
            <button
              type="button"
              className="rd-reply"
              aria-label={`Reply to ${name}`}
              onClick={() => onReply(comment)}
            >
              Reply
            </button>
          )}
        </div>
      </li>
    );
  };
  return (
    <ul className="rd-list">
      {threads.map(({ root, replies }) => (
        <li key={root.id} className="rd-thread-item">
          <ul className="rd-list">
            {item(root)}
            {replies.length > 0 && (
              <li className="rd-replies">
                <ul className="rd-list">{replies.map(item)}</ul>
              </li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Composer({
  thread,
  topics,
  fixedTopic,
  parent,
  parentName,
  autoFocus,
  value,
  onValueChange,
  onCancelReply,
  onPosted,
  onDirtyChange,
  onPostingChange,
}: {
  thread: CommentThread;
  topics: DiscussionClause[];
  fixedTopic?: CommentTopic;
  parent?: ReviewComment;
  parentName: string;
  autoFocus?: boolean;
  /** Lets a parent preserve a draft while this composer is temporarily hidden. */
  value?: string;
  onValueChange?: (value: string) => void;
  onCancelReply: () => void;
  onPosted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPostingChange?: (posting: boolean) => void;
}) {
  const id = useId();
  const [localBody, setLocalBody] = useState(""),
    [topic, setTopic] = useState<CommentTopic>(
      fixedTopic ??
        (topics.some((item) => item.id === CommentTopic.AGREEMENT)
          ? CommentTopic.AGREEMENT
          : (topics[0]?.id ?? CommentTopic.AGREEMENT)),
    ),
    [posting, setPosting] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const body = value ?? localBody;
  const setBody = (next: string) => {
    if (onValueChange) onValueChange(next);
    else setLocalBody(next);
  };
  useEffect(() => {
    // Set on every mount: dev strict mode unmounts and remounts once.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(Boolean(body.trim()));
  }, [body, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (parent || autoFocus) field.current?.focus();
  }, [parent, autoFocus]);
  // Grow with the text, up to a cap, instead of a fixed tall box.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [body]);
  const count = commentCountHint(body.length);
  return (
    <form
      className="rd-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if (posting || !body.trim()) return;
        setPosting(true);
        onPostingChange?.(true);
        setError("");
        setNotice("");
        try {
          const saved = await thread.post(body, topic, parent);
          if (!alive.current) return;
          if (!saved) {
            setError("Another comment is posting. Try again in a moment.");
            return;
          }
          setBody("");
          setNotice("Comment posted.");
          onPosted();
        } catch (e) {
          if (alive.current)
            setError(
              e instanceof Error
                ? e.message
                : "We’re not sure that posted. Refresh before trying again.",
            );
        } finally {
          if (alive.current) {
            setPosting(false);
            onPostingChange?.(false);
          }
        }
      }}
    >
      <label htmlFor={id} className="sr-only">
        {parent ? `Reply to ${parentName}` : "Your comment"}
      </label>
      <textarea
        id={id}
        ref={field}
        rows={1}
        required
        maxLength={COMMENT_LIMIT}
        disabled={posting}
        value={body}
        placeholder={parent ? `Reply to ${parentName}…` : "Add a comment…"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
            e.currentTarget.form?.requestSubmit();
          if (e.key === "Escape" && parent) onCancelReply();
        }}
      />
      <div className="rd-bar">
        {parent ? (
          <span className="rd-tag">
            Replying to {parentName}
            <button
              type="button"
              className="rd-clear"
              aria-label="Cancel reply"
              disabled={posting}
              onClick={onCancelReply}
            >
              ×
            </button>
          </span>
        ) : fixedTopic ? null : (
          <select
            className="rd-chip-select"
            aria-label="Topic"
            disabled={posting}
            value={topic}
            onChange={(e) => setTopic(e.target.value as CommentTopic)}
          >
            {topics.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <span className="rd-spacer" />
        {count && (
          <span className="rd-count" aria-live="polite">
            {count}
          </span>
        )}
        <Button className="rd-post" disabled={posting || !body.trim()}>
          {posting ? "Posting…" : parent ? "Reply" : "Post"}
        </Button>
      </div>
      {notice && (
        <p className="sr-only" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="rd-error">
          <Notice warning>{error}</Notice>
        </div>
      )}
    </form>
  );
}

/** Rule cards on the Agreement tab, as the layout names them. */
export enum RuleStep {
  OVERALL = "OVERALL",
  FEES = "FEES",
  ADVANCE = "ADVANCE",
  SPLIT = "SPLIT",
  TERM = "TERM",
  DOCUMENT = "DOCUMENT",
}
/**
 * Which API topic each rule card's comments use. The API has no separate topic for
 * the term (dates), so its comments join the general "overall" thread.
 */
export const ruleStepTopic: Record<RuleStep, CommentTopic> = {
  [RuleStep.OVERALL]: CommentTopic.AGREEMENT,
  [RuleStep.FEES]: CommentTopic.FEES,
  [RuleStep.ADVANCE]: CommentTopic.ADVANCE,
  [RuleStep.SPLIT]: CommentTopic.SPLIT,
  [RuleStep.TERM]: CommentTopic.AGREEMENT,
  [RuleStep.DOCUMENT]: CommentTopic.SOURCE,
};

export interface RuleCommentsProps extends CommentsBaseProps {
  /** The API topic for this rule; use `ruleStepTopic[step]`. */
  topic: CommentTopic;
  /** Rule name for screen readers, e.g. "Split". */
  label?: string;
  /** Comments on this rule, replies included. */
  onCountChange?: (count: number) => void;
  /** Start expanded. */
  defaultOpen?: boolean;
}
/**
 * Comments that stay with one rule, inside its card: a quiet "Comment" / "N comments"
 * toggle that opens the rule's thread and a compact composer.
 */
export function RuleComments(props: RuleCommentsProps) {
  const { agreement, version, topic, onCountChange } = props;
  const [thread, state] = useThread(threadPath(props, version.id));
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  // This thread is keyed by the agreement/version endpoint, so its per-topic
  // draft survives a parent rule-card collapse without crossing resources.
  const draft = thread.draft(topic);
  const parent = draft.parent;
  const setDraft = (body: string, parent = draft.parent) =>
    thread.setDraft(topic, { body, parent });
  const setParent = (parent: ReviewComment | undefined) =>
    setDraft(draft.body, parent);
  const threads = discussionThreads(state.comments, topic);
  const count = state.comments.filter((c) => c.ruleKey === topic).length;
  useEffect(() => {
    if (state.loaded) onCountChange?.(count);
  }, [count, state.loaded, onCountChange]);
  useEffect(() => {
    props.onDirtyChange?.(Boolean(draft.body.trim()));
  }, [draft.body, props.onDirtyChange]);
  const writable =
    props.canWrite !== false &&
    version.status !== "SUPERSEDED" &&
    agreement.value.versions.at(-1)?.id === version.id;
  const panel = useId();
  if (!writable && !count && !state.cursor) return null;
  const label = props.label ?? topicLabel(topic);
  return (
    <div className="rd-clause">
      <ClauseCommentButton
        count={count}
        label={label}
        expanded={open}
        controls={panel}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div id={panel} className="rd-clause-panel">
          <CommentList
            agreement={agreement}
            threads={threads}
            showTopic={false}
            onReply={writable ? setParent : undefined}
          />
          {writable && (
            <Composer
              key={`${thread.path}:${topic}`}
              thread={thread}
              topics={[{ id: topic, label }]}
              fixedTopic={topic}
              parent={parent}
              parentName={parent ? memberName(agreement, parent.authorId) : ""}
              autoFocus={!count}
              onCancelReply={() => setParent(undefined)}
              onPosted={() => undefined}
              value={draft.body}
              onValueChange={setDraft}
            />
          )}
          {state.cursor && (
            <button
              type="button"
              className="rd-link"
              disabled={state.loading}
              onClick={() => void thread.load(state.cursor!)}
            >
              Show more comments
            </button>
          )}
          {state.error && (
            <div role="alert">
              <Notice warning>{state.error}</Notice>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** General comments about the agreement as a whole: the overall thread on its own. */
export function AgreementComments(
  props: Omit<ReviewDiscussionProps, "topic" | "clauses">,
) {
  return <ReviewDiscussion {...props} topic={CommentTopic.AGREEMENT} />;
}

/** The quiet comment toggle on a rule card: "Comment", or "N comments" once there are some. */
export function ClauseCommentButton({
  count = 0,
  label,
  expanded,
  controls,
  onClick,
}: {
  count?: number;
  label?: string;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
}) {
  const text = count ? `${count} comment${count === 1 ? "" : "s"}` : "Comment";
  return (
    <button
      type="button"
      className="rd-clause-button"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-label={label ? `${text} on ${label}` : undefined}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      >
        <path d="M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z" />
      </svg>
      {text}
    </button>
  );
}

export function ReviewReminder({
  agreement,
  version,
  userId,
  recipientId,
}: {
  base: string;
  agreement: Agreement;
  version: Version;
  userId: string;
  recipientId: string;
}) {
  const [notice, setNotice] = useState(""),
    [fallback, setFallback] = useState("");
  if (!canRemind(agreement, version, userId, recipientId)) return null;
  const name =
    agreement.value.members.find((m) => m.userId === recipientId)
      ?.displayName ?? "this participant";
  return (
    <div>
      <Button
        type="button"
        variant="quiet"
        onClick={async () => {
          const message = `Hi ${name}, please sign in to Fairshare, open “${agreement.value.name}” and review version ${version.id}. ${publicWebOrigin(window.location.origin)}/app`;
          try {
            await navigator.clipboard.writeText(message);
            setFallback("");
            setNotice("Reminder copied. Send it to them yourself.");
          } catch {
            setFallback(message);
            setNotice("Copy the reminder below and share it directly.");
          }
        }}
      >
        Copy review reminder
      </Button>
      {notice && <p role="status">{notice}</p>}
      {fallback && (
        <textarea
          aria-label="Review reminder to copy"
          readOnly
          value={fallback}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
