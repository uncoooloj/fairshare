/** Pure aggregate transitions. Persist an entire transition in one serialized database
 * transaction; enforce globally unique provider capture IDs in the persistence layer. */
export enum MemberRole {
  ORGANIZER = "ORGANIZER",
  COLLABORATOR = "COLLABORATOR",
}
export enum VersionStatus {
  DRAFT = "DRAFT",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
  ACTIVE = "ACTIVE",
  SUPERSEDED = "SUPERSEDED",
}
export enum RuleOrigin {
  SOURCE_CLAUSE = "SOURCE_CLAUSE",
  HUMAN_PROPOSAL = "HUMAN_PROPOSAL",
}
export enum FeePolicy {
  BEFORE_SPLIT = "BEFORE_SPLIT",
  ORGANIZER_SHARE = "ORGANIZER_SHARE",
}
export enum RevenueStatus {
  CONFIRMED = "CONFIRMED",
  REVIEW_REQUIRED = "REVIEW_REQUIRED",
}
export enum AllocationStatus {
  ALLOCATED = "ALLOCATED",
  HELD = "HELD",
}
export enum AuditType {
  CREATED = "CREATED",
  VERSION_PROPOSED = "VERSION_PROPOSED",
  SENT_FOR_REVIEW = "SENT_FOR_REVIEW",
  APPROVED = "APPROVED",
  CHANGE_REQUESTED = "CHANGE_REQUESTED",
  ACTIVATED = "ACTIVATED",
  REVENUE_ALLOCATED = "REVENUE_ALLOCATED",
  PAYMENT_HELD = "PAYMENT_HELD",
}
export interface Member {
  userId: string;
  displayName: string;
  role: MemberRole;
}
export interface SourceReference {
  origin: RuleOrigin;
  documentId: string;
  clause: string;
  excerpt: string;
}
export interface Share {
  userId: string;
  basisPoints: number;
}
export interface Advance {
  id: string;
  recipientId: string;
  amountCents: number;
  verified: boolean;
  source: SourceReference;
}
export interface Rules {
  currency: "USD";
  shares: Share[];
  feePolicy: FeePolicy;
  feeBearerId?: string;
  advance?: Advance;
  source: SourceReference;
  unresolvedQuestions: string[];
}
export interface AgreementVersion {
  id: number;
  status: VersionStatus;
  rules: Rules;
  approvals: Record<string, string>;
  changeRequests: Array<{ userId: string; reason: string; at: string }>;
  createdAt: string;
}
export interface Allocation {
  userId: string;
  recoupmentCents: number;
  shareCents: number;
  feeCents: number;
  totalCents: number;
  status: AllocationStatus;
}
export interface Revenue {
  providerCaptureId: string;
  currency: "USD";
  grossCents: number;
  feeCents: number;
  netCents: number;
  versionId: number;
  allocations: Allocation[];
  status: RevenueStatus;
  at: string;
}
export interface AuditEntry {
  sequence: number;
  type: AuditType;
  actorId: string;
  at: string;
  details: Record<string, unknown>;
}
export interface Collaboration {
  id: string;
  name: string;
  members: Member[];
  versions: AgreementVersion[];
  activeVersionId?: number;
  revenue: Revenue[];
  recoupedByAdvance: Record<string, number>;
  reviewHold: boolean;
  audit: AuditEntry[];
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
function fail(code: string, message: string): never {
  throw new DomainError(code, message);
}
const nonempty = (s: string, label: string) => {
  if (typeof s !== "string" || !s.trim() || s.length > 10000)
    fail("INVALID_INPUT", `${label} is required and bounded`);
};
const cents = (n: number, label: string) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000_000)
    fail(
      "INVALID_MONEY",
      `${label} must be nonnegative integer cents within supported range`,
    );
};
const timestamp = (at: string) => {
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at)))
    fail("INVALID_TIME", "Valid timestamp required");
};
const member = (c: Collaboration, id: string) =>
  c.members.find((m) => m.userId === id) ??
  fail("FORBIDDEN", "Not a collaboration member");
const organizer = (c: Collaboration, id: string) => {
  if (member(c, id).role !== MemberRole.ORGANIZER)
    fail("FORBIDDEN", "Organizer required");
};
const copy = <T>(value: T): T => structuredClone(value);
function audit(
  c: Collaboration,
  type: AuditType,
  actorId: string,
  at: string,
  details: Record<string, unknown>,
) {
  timestamp(at);
  c.audit.push({ sequence: c.audit.length + 1, type, actorId, at, details });
}
function reference(s: SourceReference) {
  if (!s || !Object.values(RuleOrigin).includes(s.origin))
    fail("INVALID_SOURCE", "Rule origin required");
  nonempty(s.documentId, "Document");
  nonempty(s.clause, "Clause");
  nonempty(s.excerpt, "Source excerpt or explicit human proposal");
}
export function validateRules(c: Collaboration, r: Rules): void {
  if (
    !r ||
    r.currency !== "USD" ||
    !Object.values(FeePolicy).includes(r.feePolicy)
  )
    fail("INVALID_RULES", "Supported currency and fee policy required");
  if (!Array.isArray(r.shares) || r.shares.length !== c.members.length)
    fail("INVALID_SHARES", "Every participant must have one share");
  const seen = new Set<string>();
  let sum = 0;
  for (const s of r.shares) {
    member(c, s.userId);
    if (
      seen.has(s.userId) ||
      !Number.isInteger(s.basisPoints) ||
      s.basisPoints < 0 ||
      s.basisPoints > 10000
    )
      fail("INVALID_SHARES", "Unique shares in integer basis points required");
    seen.add(s.userId);
    sum += s.basisPoints;
  }
  if (sum !== 10000) fail("INVALID_SHARES", "Shares must total 100%");
  reference(r.source);
  if (
    !Array.isArray(r.unresolvedQuestions) ||
    r.unresolvedQuestions.some((q) => typeof q !== "string" || !q.trim())
  )
    fail("INVALID_RULES", "Questions must be nonempty strings");
  if (r.feePolicy === FeePolicy.ORGANIZER_SHARE) {
    if (!r.feeBearerId) fail("INVALID_RULES", "Fee bearer required");
    organizer(c, r.feeBearerId!);
  }
  if (r.advance) {
    nonempty(r.advance.id, "Advance ID");
    member(c, r.advance.recipientId);
    cents(r.advance.amountCents, "Advance");
    reference(r.advance.source);
    if (typeof r.advance.verified !== "boolean")
      fail("INVALID_RULES", "Advance verification required");
    for (const v of c.versions) {
      const old = v.rules.advance;
      if (
        old?.id === r.advance.id &&
        (old.amountCents !== r.advance.amountCents ||
          old.recipientId !== r.advance.recipientId)
      )
        fail(
          "ADVANCE_CHANGED",
          "An existing advance ID cannot change amount or recipient",
        );
    }
  }
}
export function createCollaboration(
  input: { id: string; name: string; members: Member[] },
  actorId: string,
  at: string,
): Collaboration {
  nonempty(input.id, "ID");
  nonempty(input.name, "Name");
  timestamp(at);
  if (
    !Array.isArray(input.members) ||
    !input.members.length ||
    input.members.length > 100
  )
    fail("INVALID_MEMBERS", "1–100 members required");
  const ids = new Set<string>();
  for (const m of input.members) {
    nonempty(m.userId, "User ID");
    nonempty(m.displayName, "Name");
    if (ids.has(m.userId) || !Object.values(MemberRole).includes(m.role))
      fail("INVALID_MEMBERS", "Unique valid members required");
    ids.add(m.userId);
  }
  if (input.members.filter((m) => m.role === MemberRole.ORGANIZER).length !== 1)
    fail("INVALID_MEMBERS", "Exactly one organizer required");
  const c: Collaboration = {
    ...copy(input),
    versions: [],
    revenue: [],
    recoupedByAdvance: Object.create(null),
    reviewHold: false,
    audit: [],
  };
  organizer(c, actorId);
  audit(c, AuditType.CREATED, actorId, at, {});
  return c;
}
export function proposeVersion(
  c: Collaboration,
  rules: Rules,
  actorId: string,
  at: string,
): Collaboration {
  member(c, actorId);
  validateRules(c, rules);
  const out = copy(c);
  const latest = out.versions.at(-1);
  if (
    latest &&
    [VersionStatus.DRAFT, VersionStatus.AWAITING_APPROVAL].includes(
      latest.status,
    )
  )
    latest.status = VersionStatus.SUPERSEDED;
  const v: AgreementVersion = {
    id: (latest?.id ?? 0) + 1,
    status: VersionStatus.DRAFT,
    rules: copy(rules),
    approvals: {},
    changeRequests: [],
    createdAt: at,
  };
  out.versions.push(v);
  audit(out, AuditType.VERSION_PROPOSED, actorId, at, { versionId: v.id });
  return out;
}
function latestVersion(c: Collaboration, id: number): AgreementVersion {
  const v = c.versions.at(-1);
  if (!v || v.id !== id)
    fail("STALE_VERSION", "Only the current proposal can be changed");
  return v;
}
export function sendForReview(
  c: Collaboration,
  versionId: number,
  actorId: string,
  at: string,
): Collaboration {
  member(c, actorId);
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (v.status !== VersionStatus.DRAFT) fail("INVALID_STATE", "Draft required");
  if (
    v.rules.unresolvedQuestions.length ||
    (v.rules.advance && !v.rules.advance.verified)
  )
    fail(
      "UNRESOLVED_RULES",
      "Resolve questions and verify any existing advance first",
    );
  v.status = VersionStatus.AWAITING_APPROVAL;
  audit(out, AuditType.SENT_FOR_REVIEW, actorId, at, { versionId });
  return out;
}
export function approveVersion(
  c: Collaboration,
  versionId: number,
  actorId: string,
  at: string,
): Collaboration {
  member(c, actorId);
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (v.status !== VersionStatus.AWAITING_APPROVAL)
    fail("INVALID_STATE", "Version is not awaiting approval");
  if (Object.hasOwn(v.approvals, actorId)) return out;
  Object.defineProperty(v.approvals, actorId, {
    value: at,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  audit(out, AuditType.APPROVED, actorId, at, { versionId });
  return out;
}
export function requestChange(
  c: Collaboration,
  versionId: number,
  reason: string,
  actorId: string,
  at: string,
): Collaboration {
  member(c, actorId);
  nonempty(reason, "Reason");
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (v.status !== VersionStatus.AWAITING_APPROVAL)
    fail("INVALID_STATE", "Version is not awaiting review");
  v.changeRequests.push({ userId: actorId, reason, at });
  v.approvals = {};
  v.status = VersionStatus.DRAFT;
  audit(out, AuditType.CHANGE_REQUESTED, actorId, at, { versionId, reason });
  return out;
}
export function activateVersion(
  c: Collaboration,
  versionId: number,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (
    v.status !== VersionStatus.AWAITING_APPROVAL ||
    !out.members.every((m) => Object.hasOwn(v.approvals, m.userId))
  )
    fail(
      "APPROVALS_REQUIRED",
      "Every participant must approve this exact version",
    );
  if (out.activeVersionId)
    out.versions.find((old) => old.id === out.activeVersionId)!.status =
      VersionStatus.SUPERSEDED;
  v.status = VersionStatus.ACTIVE;
  out.activeVersionId = v.id;
  audit(out, AuditType.ACTIVATED, actorId, at, { versionId });
  return out;
}
/** Largest remainder with stable user-ID tie break. Integer arithmetic, no float money. */
export function splitCents(
  total: number,
  shares: Share[],
): Record<string, number> {
  cents(total, "Total");
  if (
    !shares.length ||
    shares.reduce((s, x) => s + x.basisPoints, 0) !== 10000 ||
    new Set(shares.map((s) => s.userId)).size !== shares.length ||
    shares.some(
      (s) =>
        !Number.isInteger(s.basisPoints) ||
        s.basisPoints < 0 ||
        s.basisPoints > 10000,
    )
  )
    fail("INVALID_SHARES", "Valid 100% shares required");
  const rows = shares.map((s) => ({
    ...s,
    amount: Number((BigInt(total) * BigInt(s.basisPoints)) / 10000n),
    remainder: (BigInt(total) * BigInt(s.basisPoints)) % 10000n,
  }));
  let left = total - rows.reduce((s, x) => s + x.amount, 0);
  rows.sort((a, b) =>
    a.remainder === b.remainder
      ? a.userId < b.userId
        ? -1
        : a.userId > b.userId
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of rows)
    if (left > 0) {
      row.amount++;
      left--;
    }
  return Object.fromEntries(rows.map((r) => [r.userId, r.amount]));
}
export interface ConfirmedRevenueInput {
  providerCaptureId: string;
  currency: "USD";
  grossCents: number;
  feeCents: number;
}
/** Call only after server-side provider verification, never directly from browser claims. */
export function allocateConfirmedRevenue(
  c: Collaboration,
  input: ConfirmedRevenueInput,
  at: string,
): Collaboration {
  nonempty(input.providerCaptureId, "Capture ID");
  cents(input.grossCents, "Gross");
  cents(input.feeCents, "Fee");
  if (
    !input.grossCents ||
    input.feeCents > input.grossCents ||
    input.currency !== "USD"
  )
    fail("INVALID_MONEY", "Valid positive USD capture and fee required");
  const prior = c.revenue.find(
    (r) => r.providerCaptureId === input.providerCaptureId,
  );
  if (prior) {
    if (
      prior.grossCents !== input.grossCents ||
      prior.feeCents !== input.feeCents ||
      prior.currency !== input.currency
    )
      fail(
        "IDEMPOTENCY_CONFLICT",
        "Capture previously recorded with different money",
      );
    return copy(c);
  }
  if (c.reviewHold)
    fail(
      "PAYMENT_HOLD",
      "Collaboration needs reconciliation before further allocation",
    );
  const v = c.versions.find((v) => v.id === c.activeVersionId);
  if (!v || v.status !== VersionStatus.ACTIVE)
    fail("NO_ACTIVE_RULES", "An approved active agreement is required");
  const out = copy(c);
  const r = v.rules;
  const net = input.grossCents - input.feeCents;
  const base = r.feePolicy === FeePolicy.BEFORE_SPLIT ? net : input.grossCents;
  const paid =
    r.advance && Object.hasOwn(out.recoupedByAdvance, r.advance.id)
      ? out.recoupedByAdvance[r.advance.id]
      : 0;
  const recoupment = r.advance
    ? Math.min(base, Math.max(0, r.advance.amountCents - paid))
    : 0;
  const splits = splitCents(base - recoupment, r.shares);
  const allocations: Allocation[] = r.shares.map((s) => {
    const recoup = r.advance?.recipientId === s.userId ? recoupment : 0;
    const fee =
      r.feePolicy === FeePolicy.ORGANIZER_SHARE && r.feeBearerId === s.userId
        ? input.feeCents
        : 0;
    return {
      userId: s.userId,
      recoupmentCents: recoup,
      shareCents: splits[s.userId],
      feeCents: fee,
      totalCents: recoup + splits[s.userId] - fee,
      status: AllocationStatus.ALLOCATED,
    };
  });
  if (allocations.some((a) => a.totalCents < 0))
    fail(
      "FEE_EXCEEDS_SHARE",
      "Fee bearer cannot cover fee under agreed rules; explicit resolution required",
    );
  if (allocations.reduce((s, a) => s + a.totalCents, 0) !== net)
    fail("CONSERVATION_ERROR", "Allocation must equal actual net received");
  if (r.advance)
    Object.defineProperty(out.recoupedByAdvance, r.advance.id, {
      value: paid + recoupment,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  out.revenue.push({
    ...copy(input),
    netCents: net,
    versionId: v.id,
    allocations,
    status: RevenueStatus.CONFIRMED,
    at,
  });
  audit(out, AuditType.REVENUE_ALLOCATED, "provider", at, {
    captureId: input.providerCaptureId,
    versionId: v.id,
  });
  return out;
}
/** Preserve historical allocations and already-paid liabilities; never guess a clawback. */
export function holdReversedRevenue(
  c: Collaboration,
  captureId: string,
  reason: string,
  at: string,
): Collaboration {
  nonempty(reason, "Reason");
  const out = copy(c);
  const event = out.revenue.find((r) => r.providerCaptureId === captureId);
  if (!event)
    fail(
      "UNKNOWN_CAPTURE",
      "Unmatched provider event must be retained for reconciliation",
    );
  if (event.status === RevenueStatus.REVIEW_REQUIRED) return out;
  event.status = RevenueStatus.REVIEW_REQUIRED;
  out.reviewHold = true;
  for (const e of out.revenue)
    for (const a of e.allocations) a.status = AllocationStatus.HELD;
  audit(out, AuditType.PAYMENT_HELD, "provider", at, { captureId, reason });
  return out;
}
export interface AllocationPreview {
  previewOnly: true;
  versionId: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
  allocations: Allocation[];
  requiresClarification: boolean;
}
/** Preview is not a revenue event, approval, payment, or payout. Persist nothing. */
export function previewVersion(
  c: Collaboration,
  versionId: number,
  input: { grossCents: number; feeCents: number },
  actorId: string,
): AllocationPreview {
  member(c, actorId);
  const scratch = copy(c);
  const v =
    scratch.versions.find((v) => v.id === versionId) ??
    fail("UNKNOWN_VERSION", "Version not found");
  scratch.activeVersionId = versionId;
  v.status = VersionStatus.ACTIVE;
  scratch.reviewHold = false;
  scratch.revenue = [];
  const preview = allocateConfirmedRevenue(
    scratch,
    {
      ...input,
      currency: v.rules.currency,
      providerCaptureId: "illustrative-preview",
    },
    "2000-01-01T00:00:00.000Z",
  ).revenue[0];
  return {
    previewOnly: true,
    versionId,
    grossCents: preview.grossCents,
    feeCents: preview.feeCents,
    netCents: preview.netCents,
    allocations: preview.allocations,
    requiresClarification:
      !!v.rules.unresolvedQuestions.length ||
      !!(v.rules.advance && !v.rules.advance.verified),
  };
}
