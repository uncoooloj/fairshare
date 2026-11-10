"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Agreement, type Version, ApiError } from "../lib/model";
import {
  canRemind,
  commentPayload,
  discussionTopics,
  reminderNotice,
  discussionVersion,
  discussionThreads,
  type ReviewComment,
  type Topic,
} from "../lib/review-discussion";
import { Button, Field, Notice } from "./ui";

type DiscussionProps = {
  base: string;
  agreement: Agreement;
  version: Version;
  canWrite: boolean;
  onDirtyChange: (dirty: boolean) => void;
};
export function ReviewDiscussion(props: DiscussionProps) {
  const [versionId, setVersionId] = useState(props.version.id),
    [posting, setPosting] = useState(false);
  const dirty = useRef(false);
  const version = discussionVersion(props.agreement, versionId);
  const onDirtyChange = useCallback(
    (value: boolean) => {
      dirty.current = value;
      props.onDirtyChange(value);
    },
    [props.onDirtyChange],
  );
  if (!version) return null;
  return (
    <div>
      <Field label="Discussion version">
        <select
          disabled={posting}
          value={version.id}
          onChange={(event) => {
            if (
              dirty.current &&
              !window.confirm(
                "Discard your unsaved comment and view another version?",
              )
            )
              return;
            dirty.current = false;
            props.onDirtyChange(false);
            setVersionId(Number(event.target.value));
          }}
        >
          {[...props.agreement.value.versions].reverse().map((item) => (
            <option key={item.id} value={item.id}>
              Version {item.id}
              {item.id === props.version.id
                ? " · latest"
                : " · read-only history"}
            </option>
          ))}
        </select>
      </Field>
      {version.id !== props.version.id && (
        <Notice>
          Historical discussion is read-only. These comments belong to version{" "}
          {version.id}, not the latest terms. Switch to the latest version to
          continue the conversation.
        </Notice>
      )}
      <VersionDiscussion
        key={`${props.agreement.id}:${version.id}`}
        {...props}
        version={version}
        canWrite={props.canWrite && version.id === props.version.id}
        onDirtyChange={onDirtyChange}
        onPostingChange={setPosting}
      />
    </div>
  );
}

function VersionDiscussion({
  base,
  agreement,
  version,
  canWrite,
  onDirtyChange,
  onPostingChange,
}: DiscussionProps & { onPostingChange: (posting: boolean) => void }) {
  const [comments, setComments] = useState<ReviewComment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [topic, setTopic] = useState<Topic>("AGREEMENT"),
    [filter, setFilter] = useState<Topic | "ALL">("ALL"),
    [parent, setParent] = useState<ReviewComment>(),
    [loading, setLoading] = useState(true),
    [posting, setPosting] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    lock = useRef(false),
    loadSequence = useRef(0);
  const path = `${base}/versions/${version.id}/comments`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange(Boolean(body.trim()));
  }, [body, onDirtyChange]);
  async function load(after?: string) {
    const request = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<{
        comments: ReviewComment[];
        nextCursor: string | null;
      }>(path + (after ? `?after=${encodeURIComponent(after)}` : ""));
      if (!alive.current || request !== loadSequence.current) return;
      setComments((old) =>
        after
          ? [
              ...old,
              ...data.comments.filter((c) => !old.some((o) => o.id === c.id)),
            ]
          : data.comments,
      );
      setCursor(data.nextCursor);
    } catch (e) {
      if (alive.current && request === loadSequence.current)
        setError(e instanceof Error ? e.message : "Could not load comments.");
    } finally {
      if (alive.current && request === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [path]);
  const name = (id: string) =>
    agreement.value.members.find((m) => m.userId === id)?.displayName ??
    "Participant";
  const threads = discussionThreads(comments, filter);
  const item = (comment: ReviewComment) => (
    <article
      key={comment.id}
      style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--border, #e8eaf0)",
      }}
    >
      <strong>{name(comment.authorId)}</strong>
      <span className="muted">
        {" "}
        · {discussionTopics[comment.ruleKey]} ·{" "}
        <time dateTime={new Date(comment.createdAt).toISOString()}>
          {new Date(comment.createdAt).toLocaleString()}
        </time>
      </span>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {comment.body}
      </p>
      {canWrite && !comment.parentId && (
        <Button
          type="button"
          variant="quiet"
          disabled={posting}
          onClick={() => {
            setParent(comment);
            setTopic(comment.ruleKey);
          }}
        >
          Reply
        </Button>
      )}
    </article>
  );
  return (
    <section
      className="section"
      aria-label={`Discussion for version ${version.id}`}
    >
      <h3>Discussion · version {version.id}</h3>
      <p className="muted">
        Visible to everyone in this agreement. Comments do not change terms or
        approvals. Use Request changes to formally reopen the review.
      </p>
      <Field label="Filter discussion by topic">
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as Topic | "ALL")}
        >
          <option value="ALL">All topics</option>
          {Object.entries(discussionTopics).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        variant="quiet"
        disabled={loading || posting}
        onClick={() => void load()}
      >
        Refresh comments
      </Button>
      {loading && <p role="status">Loading comments…</p>}
      {!loading && !error && !comments.length && (
        <p className="muted">
          No comments yet. Start a conversation about these terms.
        </p>
      )}
      {threads.map(({ root, replies }) => (
        <div key={root.id}>
          {item(root)}
          <div style={{ marginLeft: 24 }}>{replies.map(item)}</div>
        </div>
      ))}
      {!loading && !error && comments.length > 0 && threads.length === 0 && (
        <p className="muted">
          No loaded comments for this topic.
          {cursor
            ? " Load more comments to check the remaining discussion."
            : ""}
        </p>
      )}
      {cursor && (
        <Button
          type="button"
          variant="secondary"
          disabled={loading || posting}
          onClick={() => void load(cursor)}
        >
          Load more comments
        </Button>
      )}
      {canWrite && version.status !== "SUPERSEDED" && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setPosting(true);
            onPostingChange(true);
            setError("");
            setNotice("");
            try {
              await api(path, "POST", commentPayload(body, topic, parent));
              if (!alive.current) return;
              setBody("");
              setParent(undefined);
              setNotice("Comment saved. Terms and approvals are unchanged.");
              await load();
            } catch (e) {
              if (alive.current)
                setError(
                  e instanceof Error
                    ? e.message
                    : "Comment status could not be confirmed. Refresh comments before trying again to avoid duplicates.",
                );
            } finally {
              lock.current = false;
              if (alive.current) {
                setPosting(false);
                onPostingChange(false);
              }
            }
          }}
        >
          {parent ? (
            <p>
              Replying to {name(parent.authorId)}{" "}
              <Button
                type="button"
                variant="quiet"
                disabled={posting}
                onClick={() => setParent(undefined)}
              >
                Cancel reply
              </Button>
            </p>
          ) : (
            <Field label="Topic">
              <select
                disabled={posting}
                value={topic}
                onChange={(e) => setTopic(e.target.value as Topic)}
              >
                {Object.entries(discussionTopics).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label={parent ? "Your reply" : "Your comment"}
            hint={`${body.length}/2,000 characters`}
          >
            <textarea
              required
              maxLength={2000}
              disabled={posting}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Button disabled={posting || !body.trim()}>
            {posting ? "Saving…" : parent ? "Post reply" : "Post comment"}
          </Button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
    </section>
  );
}

export function ReviewReminder({
  base,
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
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [attempted, setAttempted] = useState(false);
  const lock = useRef(false);
  if (!canRemind(agreement, version, userId, recipientId)) return null;
  const name =
    agreement.value.members.find((m) => m.userId === recipientId)
      ?.displayName ?? "this participant";
  return (
    <div>
      <Button
        type="button"
        variant="quiet"
        disabled={busy || attempted}
        onClick={() => setConfirm(true)}
      >
        Remind to review
      </Button>
      {confirm && (
        <div role="group" aria-label={`Confirm reminder for ${name}`}>
          <p>
            Email {name} a reminder to review version {version.id}? This does
            not approve terms or move money. At most one attempt per person
            every 24 hours.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError("");
              try {
                const result = await api(
                  `${base}/versions/${version.id}/reminders`,
                  "POST",
                  { recipientId },
                );
                setNotice(reminderNotice(result));
                setAttempted(true);
                setConfirm(false);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Reminder status could not be confirmed.",
                );
                if (
                  !(e instanceof ApiError) ||
                  e.code === "EMAIL_DELIVERY_UNCONFIRMED"
                ) {
                  setAttempted(true);
                  setConfirm(false);
                }
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? "Requesting…" : "Send review reminder"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
