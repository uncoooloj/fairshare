"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/model";
import { Button } from "./ui";
import { formatExact, formatWhen } from "../lib/dates";
import { toneForId } from "../lib/person";
import { Avatar, AvatarSize } from "./person";
import { SettingsPaneHeader } from "./settings-preferences";
type Option = { id: string; name: string };
type Log = {
  events: {
    id: string;
    actorName: string;
    action: string;
    agreementName?: string;
    createdAt: number;
  }[];
  total: number;
  nextOffset: number | null;
  actors: Option[];
  agreements: Option[];
  actions: string[];
};
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/workspace/g, "team access")
    .replace(/^./, (c) => c.toUpperCase());
export function ActivityLogSettings({ workspace }: { workspace: string }) {
  const [actor, setActor] = useState(""),
    [action, setAction] = useState(""),
    [agreement, setAgreement] = useState(""),
    [days, setDays] = useState("30"),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<Log | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setActor("");
    setAction("");
    setAgreement("");
    setOffset(0);
  }, [workspace]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ days, offset: String(offset) });
    if (workspace) q.set("workspaceId", workspace);
    if (actor) q.set("actorId", actor);
    if (action) q.set("action", action);
    if (agreement) q.set("agreementId", agreement);
    api(`settings/activity?${q}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace, actor, action, agreement, days, offset, refresh]);
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="Activity log"
        description="Every approval, edit, allocation, adjustment and payout you can access. Read-only."
      />
      <div className="settings-filters">
        <label>
          Who
          <select
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Everyone</option>
            {data?.actors.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All actions</option>
            {data?.actions.map((o) => (
              <option key={o} value={o}>
                {label(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agreement
          <select
            value={agreement}
            onChange={(e) => {
              setAgreement(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All agreements</option>
            {data?.agreements.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <select
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setOffset(0);
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="0">All time</option>
          </select>
        </label>
        <Button
          type="button"
          variant="quiet"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh
        </Button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading activity…</p>
      ) : (
        data && (
          <>
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Who</th>
                    <th scope="col">What</th>
                    <th scope="col">Agreement</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => {
                    const at = new Date(e.createdAt).toISOString();
                    return (
                      <tr key={e.id}>
                        <td>
                          <span className="settings-person">
                            <Avatar
                              name={e.actorName}
                              tone={toneForId(e.actorName)}
                              size={AvatarSize.SMALL}
                              label={false}
                            />
                            {e.actorName}
                          </span>
                        </td>
                        <td>{label(e.action)}</td>
                        <td>{e.agreementName ?? "Account"}</td>
                        <td className="settings-when">
                          <time dateTime={at} title={formatExact(at)}>
                            {formatWhen(at)}
                          </time>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!data.events.length && (
                <p className="settings-table-empty">
                  No activity matches these filters.
                </p>
              )}
            </div>
            <div className="settings-pager">
              <span className="muted">
                {data.total} matching {data.total === 1 ? "event" : "events"}
              </span>
              <span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!offset}
                  onClick={() => setOffset((n) => Math.max(0, n - 50))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={data.nextOffset === null}
                  onClick={() => setOffset(data.nextOffset ?? offset)}
                >
                  Next
                </Button>
              </span>
            </div>
          </>
        )
      )}
    </section>
  );
}
