"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/model";
import { Button } from "./ui";
import { formatDate } from "../lib/preferences";
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
    <section className="panel">
      <h2>Activity log</h2>
      <p className="muted">
        Account and accessible agreement activity. Read-only.
      </p>
      <div className="toolbar">
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
          variant="secondary"
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>What</th>
                    <th>Agreement</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td>{e.actorName}</td>
                      <td>{label(e.action)}</td>
                      <td>{e.agreementName ?? "Account / workspace"}</td>
                      <td>
                        <time dateTime={new Date(e.createdAt).toISOString()}>
                          {formatDate(e.createdAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.events.length && <p>No activity matches these filters.</p>}
            <p className="muted">{data.total} matching events</p>
            <Button
              variant="secondary"
              disabled={!offset}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={data.nextOffset === null}
              onClick={() => setOffset(data.nextOffset ?? offset)}
            >
              Next
            </Button>
          </>
        )
      )}
    </section>
  );
}
