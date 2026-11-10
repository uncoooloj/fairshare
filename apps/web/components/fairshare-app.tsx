"use client";
import {
  Logo,
  Heading,
  Metric,
  SimpleForm,
  Auth,
  AgreementList,
  SplitTable,
  RevenueTable,
  AllocationTable,
  PreviewForm,
  PasswordForm,
  AIReview,
  RulesEditor,
  safePayPalUrl,
  payoutStatus,
} from "./agreement-widgets";
import { useEffect, useState } from "react";
import {
  AgreementTab,
  Section,
  api,
  money,
  parseCents,
  parseShare,
  title,
  sampleAgreement,
  type Agreement,
  type User,
  type Rules,
  type Revenue,
} from "../lib/model";
import { PaymentRecovery } from "./payment-recovery";
import { recoverSourceDocument } from "../lib/source-recovery";
import dynamic from "next/dynamic";
const PaymentGrid = dynamic(
  () => import("../src/components/PaymentGrid").then((m) => m.PaymentGrid),
  { ssr: false, loading: () => <p>Loading payout history…</p> },
);
import { PaymentGridStatus } from "../src/components/paymentGridModel";
import { Badge, Button, Empty, Field, Icon, Notice } from "./ui";
const workspaceBase = (id: string) => `workspaces/${id}`;
export default function FairshareApp() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [workspaces, setWorkspaces] = useState<any[]>([]),
    [workspace, setWorkspace] = useState(""),
    [agreements, setAgreements] = useState<Agreement[]>([]),
    [selected, setSelected] = useState<Agreement | null>(null),
    [section, setSection] = useState(Section.Overview),
    [tab, setTab] = useState(AgreementTab.Overview),
    [members, setMembers] = useState<any[]>([]),
    [payments, setPayments] = useState<any[]>([]),
    [payouts, setPayouts] = useState<any[]>([]),
    [mode, setMode] = useState("Unavailable");
  const [creating, setCreating] = useState(false),
    [search, setSearch] = useState(""),
    [source, setSource] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [extraction, setExtraction] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [breakdown, setBreakdown] = useState<Revenue | null>(null),
    [inviteLink, setInviteLink] = useState(""),
    [flowToken, setFlowToken] = useState(""),
    [flowKind, setFlowKind] = useState("");
  const base = selected
    ? `${workspaceBase(selected.workspaceId)}/collaborations/${selected.id}`
    : "";
  const latest = selected?.value.versions.at(-1),
    active = selected?.value.versions.find(
      (v) => v.id === selected.value.activeVersionId,
    );
  const organizer =
    selected?.value.members.find((m) => m.userId === user?.id)?.role ===
    "ORGANIZER";
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function loadWorkspaces() {
    const r = await api("workspaces");
    setWorkspaces(r.workspaces);
    const id =
      workspace && r.workspaces.some((w: any) => w.id === workspace)
        ? workspace
        : r.workspaces[0]?.id || "";
    setWorkspace(id);
    return id;
  }
  async function loadWorkspace(id: string) {
    if (!id) return;
    const [r, m] = await Promise.all([
      api(`${workspaceBase(id)}/collaborations`),
      api(`${workspaceBase(id)}/members`),
    ]);
    setAgreements(r.collaborations);
    setMembers(m.members);
    const all = await Promise.all(
      r.collaborations.map(async (a: Agreement) => {
        const p = await api(
          `${workspaceBase(id)}/collaborations/${a.id}/payouts`,
        );
        return p.payouts.map((v: any) => ({ ...v, agreement: a }));
      }),
    );
    setPayouts(all.flat());
  }
  async function openAgreement(a: Agreement) {
    const root = `${workspaceBase(a.workspaceId)}/collaborations/${a.id}`;
    const [fresh, p] = await Promise.all([
      api<Agreement>(root),
      api(`${root}/payments`),
    ]);
    setSelected(fresh);
    setPayments(p.payments);
    setSection(Section.Agreements);
    setCreating(false);
    setPreview(null);
    setBreakdown(null);
    setEditing(false);
    setSource("");
    setDocumentId("");
    setExtraction(null);
    const v = fresh.value.versions.at(-1);
    const doc = await recoverSourceDocument(
      root,
      v?.rules.source.documentId,
      api,
    );
    if (doc) {
      setDocumentId(doc.documentId);
      setSource(doc.text);
      setExtraction(doc.extraction);
    }
  }
  async function refresh() {
    await loadWorkspace(workspace);
    if (selected) {
      const a = await api<Agreement>(base);
      setSelected(a);
      const p = await api(`${base}/payments`);
      setPayments(p.payments);
    }
  }
  useEffect(() => {
    const token = location.hash.slice(1).replace(/^token=/, "");
    if (token && ["/verify-email", "/invitation"].includes(location.pathname)) {
      setFlowKind(location.pathname);
      setFlowToken(decodeURIComponent(token));
      history.replaceState(null, "", location.pathname);
    }
    Promise.all([
      api("auth/me")
        .then((r) => setUser(r.user))
        .catch(() => {}),
      api("health")
        .then((r) => setMode(r.mode))
        .catch(() => {}),
    ]).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user)
      run(async () => {
        await loadWorkspaces();
      });
  }, [user?.id]);
  useEffect(() => {
    if (workspace && user) run(() => loadWorkspace(workspace));
  }, [workspace]);
  function navigate(s: Section) {
    setSection(s);
    setSelected(null);
    setCreating(false);
    setError("");
    setNotice("");
  }
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    const a = await api<Agreement>(base + action, "POST", {
      expectedRevision: selected!.revision,
      ...extra,
    });
    setSelected(a);
    await loadWorkspace(workspace);
  }
  if (!ready)
    return (
      <main className="boot" aria-live="polite">
        <Logo />
        <p>Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <Auth
        busy={busy}
        error={error}
        onSubmit={(type, data) =>
          run(async () => {
            const r = await api(`auth/${type}`, "POST", data);
            setUser(r.user);
          })
        }
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Main navigation">
          {Object.values(Section).map((s) => (
            <button
              key={s}
              className={section === s ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(s)}
            >
              <Icon name={s} />
              {s}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">{mode} · no live money</span>
          <div className="identity">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await api("auth/logout", "POST", {});
                setUser(null);
                setWorkspace("");
                setSelected(null);
                setAgreements([]);
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="workspace-bar">
          <span>Workspace</span>
          <select
            aria-label="Workspace"
            value={workspace}
            onChange={(e) => {
              setSelected(null);
              setWorkspace(e.target.value);
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <Button variant="quiet" disabled={busy} onClick={() => run(refresh)}>
            ↻ Refresh
          </Button>
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
            {error.includes("Reload") && (
              <Button variant="quiet" onClick={() => run(refresh)}>
                Reload latest
              </Button>
            )}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="progress" role="status">
            Working…
          </div>
        )}
        {flowToken && (
          <Notice>
            <h3>
              {flowKind === "/verify-email"
                ? "Verify your email"
                : "Accept your invitation"}
            </h3>
            <p>
              You are signed in as {user.email}. Use the account the invitation
              was sent to.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (flowKind === "/verify-email") {
                    const r = await api("auth/verification/confirm", "POST", {
                      token: flowToken,
                    });
                    setUser(r.user);
                    setNotice(
                      r.verificationMode === "DEMO_SIMULATION"
                        ? "Demo verification completed. This does not prove email ownership."
                        : "Email verified.",
                    );
                  } else {
                    await api("invitations/accept", "POST", {
                      token: flowToken,
                    });
                    await loadWorkspaces();
                    setNotice("Invitation accepted.");
                  }
                  setFlowToken("");
                  history.replaceState(null, "", "/");
                })
              }
            >
              Continue
            </Button>
          </Notice>
        )}
        {!workspace ? (
          <>
            <Heading
              title="Welcome to Fairshare"
              description="Create a workspace to start your first agreement."
            />
            <SimpleForm
              label="Workspace name"
              button="Create workspace"
              busy={busy}
              onSubmit={(name) =>
                run(async () => {
                  await api("workspaces", "POST", { name });
                  await loadWorkspaces();
                })
              }
            />
          </>
        ) : (
          <>
            {section === Section.Overview && !selected && (
              <>
                <Heading
                  title={`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${user.name.split(" ")[0]}`}
                  description="Your agreements, and what needs your attention."
                  action={
                    <Button
                      onClick={() => {
                        setSection(Section.Agreements);
                        setCreating(true);
                      }}
                    >
                      + New agreement
                    </Button>
                  }
                />
                <div className="metrics">
                  <Metric
                    label="Agreements"
                    value={String(agreements.length)}
                  />
                  <Metric
                    label="Awaiting approvals"
                    value={String(
                      agreements.filter(
                        (a) =>
                          a.value.versions.at(-1)?.status ===
                          "AWAITING_APPROVAL",
                      ).length,
                    )}
                  />
                  <Metric
                    label="Payment holds"
                    value={String(
                      agreements.filter((a) => a.value.reviewHold).length,
                    )}
                  />
                </div>
                <AgreementList
                  agreements={agreements}
                  onOpen={(a) => run(() => openAgreement(a))}
                />
              </>
            )}
            {section === Section.Agreements && !selected && (
              <>
                <Heading
                  title={creating ? "Create an agreement" : "Agreements"}
                  description={
                    creating
                      ? "Bring the people, terms and money into one place."
                      : "Every agreement has a clear money trail."
                  }
                  action={
                    !creating && (
                      <Button onClick={() => setCreating(true)}>
                        + New agreement
                      </Button>
                    )
                  }
                />
                {creating ? (
                  <div className="narrow">
                    <SimpleForm
                      label="Agreement name"
                      button="Create agreement"
                      busy={busy}
                      onSubmit={(name) =>
                        run(async () => {
                          const a = await api<Agreement>(
                            `${workspaceBase(workspace)}/collaborations`,
                            "POST",
                            { name },
                          );
                          await openAgreement(a);
                          setTab(AgreementTab.People);
                          await loadWorkspace(workspace);
                        })
                      }
                    />
                    <Button variant="quiet" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <input
                      className="search"
                      aria-label="Search agreements"
                      placeholder="Search agreements…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <AgreementList
                      agreements={agreements.filter((a) =>
                        a.value.name
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )}
                      onOpen={(a) => run(() => openAgreement(a))}
                    />
                  </>
                )}
              </>
            )}
            {selected && section === Section.Agreements && (
              <>
                <button
                  className="breadcrumb text-button"
                  onClick={() => setSelected(null)}
                >
                  Agreements <span>/</span> {selected.value.name}
                </button>
                <Heading
                  title={selected.value.name}
                  badge={
                    <Badge
                      value={
                        selected.value.reviewHold
                          ? "REVIEW_REQUIRED"
                          : active
                            ? "ACTIVE"
                            : latest?.status || "DRAFT"
                      }
                    />
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => navigate(Section.Payouts)}
                    >
                      View payouts
                    </Button>
                  }
                />
                <div className="tabs" role="tablist">
                  {Object.values(AgreementTab).map((t) => (
                    <button
                      role="tab"
                      aria-selected={tab === t}
                      key={t}
                      className={tab === t ? "active" : ""}
                      onClick={() => {
                        setTab(t);
                        setBreakdown(null);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {selected.value.reviewHold && (
                  <Notice warning>
                    Payments need review. Allocations remain recorded; outgoing
                    payouts are paused. No automatic clawback is assumed.
                  </Notice>
                )}
                {tab === AgreementTab.Overview && (
                  <>
                    <div className="detail-columns">
                      <section>
                        <h2>Agreed split</h2>
                        <p className="muted">
                          {active
                            ? "The active rules for this agreement."
                            : "No active rules yet. Review and approve a version to begin."}
                        </p>
                        {active ? (
                          <SplitTable
                            agreement={selected}
                            rules={active.rules}
                          />
                        ) : (
                          <Empty
                            title="Agree on the rules first"
                            action={
                              <Button
                                onClick={() => setTab(AgreementTab.Terms)}
                              >
                                Set up terms
                              </Button>
                            }
                          >
                            Add your people, upload the agreement and review a
                            proposed split together.
                          </Empty>
                        )}
                        {active?.rules.advance && (
                          <section className="section">
                            <h2>Recoupment</h2>
                            <p>
                              {money(active.rules.advance.amountCents)} advance
                              to{" "}
                              {
                                selected.value.members.find(
                                  (m) =>
                                    m.userId ===
                                    active.rules.advance!.recipientId,
                                )?.displayName
                              }
                              .
                            </p>
                            <progress
                              max={active.rules.advance.amountCents || 1}
                              value={
                                selected.value.recoupedByAdvance[
                                  active.rules.advance.id
                                ] || 0
                              }
                            />
                            <p className="muted">
                              {money(
                                selected.value.recoupedByAdvance[
                                  active.rules.advance.id
                                ] || 0,
                              )}{" "}
                              allocated toward recoupment. This is not proof of
                              a completed payout.
                            </p>
                          </section>
                        )}
                      </section>
                      <aside className="panel">
                        <h2>Payout status</h2>
                        <p className="muted">
                          An allocation records who is owed what. A payout
                          records money sent to a recipient.
                        </p>
                        <p>
                          {
                            payouts.filter(
                              (p) => p.agreement.id === selected.id,
                            ).length
                          }{" "}
                          payout items recorded
                        </p>
                        <Button
                          variant="secondary"
                          onClick={() => navigate(Section.Payouts)}
                        >
                          Open payouts
                        </Button>
                      </aside>
                    </div>
                    <section className="section">
                      <h2>Incoming payments</h2>
                      <RevenueTable
                        agreement={selected}
                        onOpen={setBreakdown}
                      />
                    </section>
                    <section className="section">
                      <h2>Activity</h2>
                      <ul className="activity">
                        {selected.value.audit
                          .slice(-6)
                          .reverse()
                          .map((e) => (
                            <li key={e.sequence}>
                              <span>{title(e.type)}</span>
                              <time>{new Date(e.at).toLocaleString()}</time>
                            </li>
                          ))}
                      </ul>
                    </section>
                  </>
                )}
                {tab === AgreementTab.People && (
                  <>
                    <Heading
                      small
                      title="People in this agreement"
                      description="Add everyone before drafting rules. Each person approves their own account’s decision."
                    />
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Latest approval</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.value.members.map((m) => (
                          <tr key={m.userId}>
                            <td>
                              <span className="avatar small">
                                {m.displayName[0]}
                              </span>
                              {m.displayName}
                              {m.userId === user.id ? " (you)" : ""}
                            </td>
                            <td>{title(m.role)}</td>
                            <td>
                              <Badge
                                value={
                                  latest?.approvals[m.userId]
                                    ? "APPROVED"
                                    : "PENDING"
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {organizer && !selected.value.versions.length && (
                      <section className="section">
                        <h3>Add an existing workspace member</h3>
                        {members
                          .filter(
                            (m) =>
                              !selected.value.members.some(
                                (s) => s.userId === m.id,
                              ),
                          )
                          .map((m) => (
                            <div className="row" key={m.id}>
                              <span>
                                {m.name} <small>{m.email}</small>
                              </span>
                              <Button
                                disabled={busy}
                                variant="secondary"
                                onClick={() =>
                                  run(() =>
                                    mutate("/members", { userId: m.id }),
                                  )
                                }
                              >
                                Add to agreement
                              </Button>
                            </div>
                          ))}
                        <SimpleForm
                          label="Invite someone by email"
                          type="email"
                          button="Create invitation"
                          busy={busy}
                          onSubmit={(email) =>
                            run(async () => {
                              const r = await api(
                                `${workspaceBase(workspace)}/invitations`,
                                "POST",
                                { email, role: "MEMBER" },
                              );
                              const token = r.invitation?.token;
                              setInviteLink(
                                r.invitation?.demoInvitationLink ||
                                  r.demoInvitationLink ||
                                  (token
                                    ? `${location.origin}/invitation#token=${encodeURIComponent(token)}`
                                    : ""),
                              );
                              setNotice(
                                r.notice ||
                                  `Invitation: ${title(r.delivery)}. Recipient must accept before being added to this agreement.`,
                              );
                            })
                          }
                        />
                        {inviteLink && (
                          <Notice>
                            <p>
                              Share this invitation privately with the named
                              recipient.
                            </p>
                            <input
                              aria-label="Invitation link"
                              readOnly
                              value={inviteLink}
                            />
                            <Button
                              variant="secondary"
                              onClick={() =>
                                run(async () => {
                                  await navigator.clipboard.writeText(
                                    inviteLink,
                                  );
                                  setNotice("Invitation copied.");
                                })
                              }
                            >
                              Copy invitation
                            </Button>
                          </Notice>
                        )}
                      </section>
                    )}
                    <section className="section">
                      <h3>Your payout destination</h3>
                      <p className="muted">
                        Only you can set your destination. This is a PayPal
                        sandbox merchant ID, not an email.
                      </p>
                      <SimpleForm
                        label="Your sandbox PayPal recipient ID"
                        button="Save destination"
                        busy={busy}
                        onSubmit={(paypalId) =>
                          run(async () => {
                            await api(`${base}/recipient`, "PUT", { paypalId });
                            setNotice(
                              "Your sandbox payout destination was saved.",
                            );
                          })
                        }
                      />
                    </section>
                  </>
                )}
                {tab === AgreementTab.Terms && (
                  <>
                    <Heading
                      small
                      title="Terms everyone can understand"
                      description="AI suggests an interpretation. People agree on the rules. The engine calculates the money."
                    />
                    {!editing && latest ? (
                      <>
                        <div className="row">
                          <h3>Version {latest.id}</h3>
                          <Badge value={latest.status} />
                          <Button
                            variant="secondary"
                            onClick={() => setEditing(true)}
                          >
                            Propose revised terms
                          </Button>
                        </div>
                        <SplitTable agreement={selected} rules={latest.rules} />
                        <Notice>
                          Fee policy:{" "}
                          {latest.rules.feePolicy === "BEFORE_SPLIT"
                            ? "Fees deducted before the split"
                            : "Organizer covers fees from their share"}
                          .{" "}
                          {latest.rules.source.origin === "HUMAN_PROPOSAL"
                            ? "These terms include a human proposal."
                            : "These terms cite a source clause."}
                        </Notice>
                        <blockquote>
                          {latest.rules.source.excerpt}
                          <footer>{latest.rules.source.clause}</footer>
                        </blockquote>
                        {latest.rules.unresolvedQuestions.map((q, i) => (
                          <Notice key={i} warning>
                            {q}
                          </Notice>
                        ))}
                        <div className="actions">
                          {latest.status === "DRAFT" && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                run(() => mutate(`/versions/${latest.id}/send`))
                              }
                            >
                              Send for everyone’s review
                            </Button>
                          )}
                          {latest.status === "AWAITING_APPROVAL" && (
                            <>
                              <Button
                                disabled={busy || !!latest.approvals[user.id]}
                                onClick={() =>
                                  run(() =>
                                    mutate(`/versions/${latest.id}/approve`),
                                  )
                                }
                              >
                                {latest.approvals[user.id]
                                  ? "You approved"
                                  : "Approve this version"}
                              </Button>
                              {organizer && (
                                <Button
                                  disabled={
                                    busy ||
                                    !selected.value.members.every(
                                      (m) => latest.approvals[m.userId],
                                    )
                                  }
                                  onClick={() =>
                                    run(() =>
                                      mutate(`/versions/${latest.id}/activate`),
                                    )
                                  }
                                >
                                  Activate agreed rules
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                        {latest.status === "AWAITING_APPROVAL" && (
                          <SimpleForm
                            label="Request a change"
                            button="Send change request"
                            busy={busy}
                            onSubmit={(reason) =>
                              run(() =>
                                mutate(
                                  `/versions/${latest.id}/request-change`,
                                  { reason },
                                ),
                              )
                            }
                          />
                        )}
                        <section className="section">
                          <h3>Preview an incoming payment</h3>
                          <p className="muted">
                            Illustrative only. No payment or payout is created.
                          </p>
                          <PreviewForm
                            busy={busy}
                            onSubmit={(grossCents, feeCents) =>
                              run(async () =>
                                setPreview(
                                  await api(
                                    `${base}/versions/${latest.id}/preview`,
                                    "POST",
                                    { grossCents, feeCents },
                                  ),
                                ),
                              )
                            }
                          />
                          {preview && (
                            <AllocationTable
                              allocations={preview.allocations}
                              agreement={selected}
                            />
                          )}
                        </section>
                        {latest.changeRequests.map((c, i) => (
                          <Notice key={i}>
                            {
                              selected.value.members.find(
                                (m) => m.userId === c.userId,
                              )?.displayName
                            }{" "}
                            requested: {c.reason}
                          </Notice>
                        ))}
                      </>
                    ) : (
                      <>
                        <section className="panel">
                          <h3>Source agreement</h3>
                          <Field
                            label="Agreement text"
                            hint="Use synthetic or authorized documents only. Text is stored privately in this workspace."
                          >
                            <textarea
                              rows={8}
                              value={source}
                              maxLength={40000}
                              onChange={(e) => {
                                setSource(e.target.value);
                                setDocumentId("");
                                setExtraction(null);
                              }}
                            />
                          </Field>
                          <div className="actions">
                            <label className="button secondary">
                              Choose PDF or text file
                              <input
                                className="visually-hidden"
                                type="file"
                                accept=".txt,.pdf,text/plain,application/pdf"
                                onChange={(e) =>
                                  run(async () => {
                                    const f = e.target.files?.[0];
                                    if (!f) return;
                                    if (f.name.toLowerCase().endsWith(".pdf")) {
                                      if (f.size > 5 * 1024 * 1024)
                                        throw new Error(
                                          "PDF must be no larger than 5 MB.",
                                        );
                                      const data = await new Promise<string>(
                                        (resolve, reject) => {
                                          const reader = new FileReader();
                                          reader.onload = () =>
                                            resolve(
                                              String(reader.result).split(
                                                ",",
                                              )[1],
                                            );
                                          reader.onerror = () =>
                                            reject(
                                              new Error("Unable to read file."),
                                            );
                                          reader.readAsDataURL(f);
                                        },
                                      );
                                      const doc = await api(
                                        `${base}/documents/pdf`,
                                        "POST",
                                        {
                                          mimeType: "application/pdf",
                                          base64: data,
                                        },
                                      );
                                      const saved = await api(
                                        `${base}/documents/${doc.documentId}`,
                                      );
                                      setSource(saved.text);
                                      setDocumentId(doc.documentId);
                                      setNotice(
                                        "PDF text extracted. Review it carefully: reading order may differ from the original. Scanned images are not supported.",
                                      );
                                    } else {
                                      if (f.size > 40000)
                                        throw new Error(
                                          "Text file is too large. Limit: 40 KB.",
                                        );
                                      setSource(await f.text());
                                      setDocumentId("");
                                    }
                                    setExtraction(null);
                                  })
                                }
                              />
                            </label>
                            <Button
                              variant="quiet"
                              onClick={() => {
                                setSource(sampleAgreement);
                                setDocumentId("");
                              }}
                            >
                              Use sample text
                            </Button>
                            <Button
                              disabled={busy || !source.trim() || !!documentId}
                              onClick={() =>
                                run(async () => {
                                  const doc = await api(
                                    `${base}/documents`,
                                    "POST",
                                    { text: source },
                                  );
                                  setDocumentId(doc.documentId);
                                  setNotice(
                                    "Source saved. You can review rules manually or ask AI for suggestions.",
                                  );
                                })
                              }
                            >
                              {documentId ? "Source saved" : "Save source"}
                            </Button>
                          </div>
                        </section>
                        {documentId && (
                          <>
                            <AIReview
                              busy={busy}
                              extraction={extraction}
                              onExtract={() =>
                                run(async () =>
                                  setExtraction(
                                    await api(
                                      `${base}/documents/${documentId}/extract`,
                                      "POST",
                                      { consentToCloudflare: true },
                                    ),
                                  ),
                                )
                              }
                            />
                            <RulesEditor
                              extraction={extraction}
                              key={documentId}
                              agreement={selected}
                              source={source}
                              documentId={documentId}
                              busy={busy}
                              onSave={(rules) =>
                                run(async () => {
                                  await mutate("/versions", { rules });
                                  setEditing(false);
                                  setNotice(
                                    "New proposal saved. No rules were activated.",
                                  );
                                })
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {tab === AgreementTab.Payments && (
                  <>
                    <Heading
                      small
                      title="Incoming payments"
                      description="Confirmed provider data is used to calculate each allocation. Browser returns are not proof of payment."
                    />
                    {organizer && active && (
                      <SimpleForm
                        label="Sandbox checkout amount (USD)"
                        type="text"
                        button="Create sandbox checkout"
                        busy={busy}
                        onSubmit={(amount) =>
                          run(async () => {
                            const amountCents = parseCents(amount);
                            const storageKey = `fairshare-checkout:${user.id}:${selected.id}:${amountCents}`;
                            const requestKey =
                              sessionStorage.getItem(storageKey) ||
                              crypto.randomUUID();
                            sessionStorage.setItem(storageKey, requestKey);
                            const r = await api(`${base}/payments`, "POST", {
                              requestKey,
                              amountCents,
                            });
                            // Preserve uncertain requests across refreshes; never blindly issue a new provider write.
                            if (r.approval_url)
                              sessionStorage.removeItem(storageKey);
                            await refresh();
                            setNotice(
                              r.approval_url
                                ? "Sandbox checkout created. Use the approval link below."
                                : "Payment request recorded. Check its status before trying again.",
                            );
                          })
                        }
                      />
                    )}
                    <table>
                      <thead>
                        <tr>
                          <th>Payment</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <code>{p.id.slice(0, 8)}</code>
                            </td>
                            <td>{money(p.amount)}</td>
                            <td>
                              <Badge value={p.status} />
                            </td>
                            <td>
                              <div className="actions">
                                {p.approval_url &&
                                  safePayPalUrl(p.approval_url) && (
                                    <a
                                      href={p.approval_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Open PayPal sandbox ↗
                                    </a>
                                  )}
                                {organizer && p.status === "AWAITING_BUYER" && (
                                  <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `${base}/payments/${p.id}/capture`,
                                          "POST",
                                          {},
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    Confirm approved payment
                                  </Button>
                                )}
                                {organizer && (
                                  <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `${base}/payments/${p.id}/reconcile`,
                                          "POST",
                                          {},
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    Check status
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!payments.length && (
                      <Empty title="No incoming payments yet">
                        An active, unanimously approved version and a configured
                        sandbox provider are required.
                      </Empty>
                    )}
                    {organizer && (
                      <PaymentRecovery
                        key={base}
                        base={base}
                        payments={payments}
                        payouts={payouts}
                        held={!!selected.value.reviewHold}
                        refresh={refresh}
                      />
                    )}
                    <section className="section">
                      <h3>Verified allocations</h3>
                      <RevenueTable
                        agreement={selected}
                        onOpen={setBreakdown}
                      />
                    </section>
                  </>
                )}
                {breakdown && (
                  <section className="panel breakdown">
                    <div className="row">
                      <h2>How this payment was allocated</h2>
                      <Button
                        variant="quiet"
                        onClick={() => setBreakdown(null)}
                      >
                        Close
                      </Button>
                    </div>
                    <p>
                      Gross {money(breakdown.grossCents)} − fees{" "}
                      {money(breakdown.feeCents)} = {money(breakdown.netCents)}{" "}
                      available.
                    </p>
                    <AllocationTable
                      allocations={breakdown.allocations}
                      agreement={selected}
                    />
                    <p className="muted">
                      Applied version {breakdown.versionId}. Recoupment is
                      included in each recipient’s total. An allocation is not
                      proof of payout.
                    </p>
                    <blockquote>
                      {
                        selected.value.versions.find(
                          (v) => v.id === breakdown.versionId,
                        )?.rules.source.excerpt
                      }
                    </blockquote>
                    {organizer && (
                      <Button
                        disabled={busy || selected.value.reviewHold}
                        onClick={() =>
                          run(async () => {
                            await api(`${base}/payouts/dispatch`, "POST", {
                              captureId: breakdown.providerCaptureId,
                            });
                            await refresh();
                            setNotice(
                              "Sandbox payout dispatch recorded. Check each item’s status; submission does not mean completion.",
                            );
                          })
                        }
                      >
                        Send fixed allocations in sandbox
                      </Button>
                    )}
                    <p className="muted">
                      Technical sandbox dispatch, not a vote on the shares.
                      Automatic scheduling is not enabled yet.
                    </p>
                  </section>
                )}
              </>
            )}
            {section === Section.Payouts && !selected && (
              <>
                <Heading
                  title="Payouts"
                  description="Track money going to people, across all your agreements."
                />
                <Notice>
                  Allocations are calculated from approved rules. These statuses
                  describe provider payout operations, not approval of someone’s
                  share.
                </Notice>
                <PaymentGrid
                  loading={busy}
                  rows={payouts.map((p) => ({
                    id: p.id,
                    agreementId: p.agreement.id,
                    agreementName: p.agreement.value.name,
                    recipientName:
                      p.agreement.value.members.find(
                        (m: any) => m.userId === p.user_id,
                      )?.displayName || "Recipient",
                    amountCents: p.amount,
                    currency: "USD",
                    status: payoutStatus(p.status),
                    providerReference: p.item_id || p.batch_id || undefined,
                  }))}
                  onOpenAgreement={(id) => {
                    const a = agreements.find((a) => a.id === id);
                    if (a) run(() => openAgreement(a));
                  }}
                />
                {payouts.length > 0 && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        for (const p of payouts.filter(
                          (p) =>
                            p.agreement.value.members.find(
                              (m: any) => m.userId === user.id,
                            )?.role === "ORGANIZER" && p.batch_id,
                        )) {
                          await api(
                            `${workspaceBase(workspace)}/collaborations/${p.agreement.id}/payouts/${p.id}/reconcile`,
                            "POST",
                            {},
                          );
                        }
                        await loadWorkspace(workspace);
                      })
                    }
                  >
                    Refresh provider statuses
                  </Button>
                )}
              </>
            )}
            {section === Section.Settings && !selected && (
              <>
                <Heading
                  title="Settings"
                  description="Your account and test environment."
                />
                <div className="narrow">
                  <section className="panel">
                    <h3>{user.name}</h3>
                    <p>{user.email}</p>
                    <p className="muted">
                      Current environment: {mode}. Live money is disabled.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await api(
                            "auth/verification/request",
                            "POST",
                            {},
                          );
                          setNotice(
                            r.notice ||
                              "Verification email requested. Check your inbox.",
                          );
                          if (r.demoVerificationLink)
                            setInviteLink(r.demoVerificationLink);
                        })
                      }
                    >
                      Verify email
                    </Button>
                    {inviteLink && (
                      <a className="block-link" href={inviteLink}>
                        Open demo verification/invitation link
                      </a>
                    )}
                  </section>
                  <PasswordForm
                    busy={busy}
                    onSubmit={(currentPassword, newPassword) =>
                      run(async () => {
                        await api("auth/password", "POST", {
                          currentPassword,
                          newPassword,
                        });
                        setUser(null);
                        setWorkspace("");
                      })
                    }
                  />
                  <SimpleForm
                    label="Invitation token (if shared manually)"
                    button="Accept invitation"
                    busy={busy}
                    onSubmit={(token) =>
                      run(async () => {
                        await api("invitations/accept", "POST", { token });
                        await loadWorkspaces();
                        setNotice("Invitation accepted.");
                      })
                    }
                  />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
