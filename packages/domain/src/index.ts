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
/** Agreement metadata currency. Allocation, payments and payouts remain USD-only
 * (see Rules.currency and Revenue.currency); this only labels the agreement. */
export enum Currency {
  USD = "USD",
}
export enum AuditType {
  CREATED = "CREATED",
  VERSION_PROPOSED = "VERSION_PROPOSED",
  SENT_FOR_REVIEW = "SENT_FOR_REVIEW",
  APPROVED = "APPROVED",
  CHANGE_REQUESTED = "CHANGE_REQUESTED",
  ACTIVATED = "ACTIVATED",
  ADVANCE_CONFIRMED = "ADVANCE_CONFIRMED",
  REVENUE_ALLOCATED = "REVENUE_ALLOCATED",
  PAYMENT_HELD = "PAYMENT_HELD",
  PERSON_ADDED = "PERSON_ADDED",
  PERSON_REMOVED = "PERSON_REMOVED",
  PERSON_JOINED = "PERSON_JOINED",
  INVITE_REISSUED = "INVITE_REISSUED",
  ORGANIZER_HANDOVER_OFFERED = "ORGANIZER_HANDOVER_OFFERED",
  ORGANIZER_HANDOVER_CANCELLED = "ORGANIZER_HANDOVER_CANCELLED",
  ORGANIZER_HANDOVER_DECLINED = "ORGANIZER_HANDOVER_DECLINED",
  ORGANIZER_HANDED_OVER = "ORGANIZER_HANDED_OVER",
}
/** A person named in the agreement who has not accepted their invitation yet. */
export interface PendingInvite {
  invitationId: string;
  email: string;
}
export interface Member {
  /** `pending:<invitationId>` while `pending` is set; the real user ID after joining. */
  userId: string;
  displayName: string;
  role: MemberRole;
  pending?: PendingInvite;
}
export const PENDING_USER_PREFIX = "pending:";
/** Placeholder user ID that rules use for a person who has not joined yet. */
export const pendingUserId = (invitationId: string) =>
  PENDING_USER_PREFIX + invitationId;
export const isPendingMember = (m: Member) => !!m.pending;
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
/** Display/storage metadata only. Dates are calendar dates (YYYY-MM-DD).
 * effectiveTo null means "no end date"; undefined means not set. */
export interface AgreementDetails {
  currency: Currency;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}
export interface AgreementDetailsPatch {
  currency?: Currency;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}
/** The organizer's open offer to hand the role to another joined member. */
export interface OrganizerHandover {
  fromUserId: string;
  toUserId: string;
  at: string;
}
export interface Collaboration {
  id: string;
  name: string;
  /** Absent on agreements created before details existed; read via agreementDetails(). */
  details?: AgreementDetails;
  members: Member[];
  versions: AgreementVersion[];
  activeVersionId?: number;
  revenue: Revenue[];
  recoupedByAdvance: Record<string, number>;
  reviewHold: boolean;
  audit: AuditEntry[];
  /** At most one open offer; cleared when accepted, declined, cancelled or replaced. */
  organizerHandover?: OrganizerHandover;
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
/** Someone acting on the agreement: a member who has joined (never a pending placeholder). */
const actor = (c: Collaboration, id: string) => {
  const m = member(c, id);
  if (m.pending || id.startsWith(PENDING_USER_PREFIX))
    fail("PENDING_MEMBER", "Join the agreement before acting on it");
  return m;
};
const organizer = (c: Collaboration, id: string) => {
  if (actor(c, id).role !== MemberRole.ORGANIZER)
    fail("FORBIDDEN", "Organizer required");
};
/** Whoever handed over organizing keeps covering fees under ORGANIZER_SHARE: a handover
 * never changes the money split, so the fee bearer may be the current or a former organizer. */
const feeBearer = (c: Collaboration, id: string) => {
  const m = actor(c, id);
  if (
    m.role !== MemberRole.ORGANIZER &&
    !c.audit.some(
      (e) =>
        e.type === AuditType.ORGANIZER_HANDED_OVER &&
        e.details.fromUserId === id,
    )
  )
    fail("FORBIDDEN", "Organizer required");
};
const noPendingMembers = (c: Collaboration) => {
  if (c.members.some((m) => m.pending))
    fail(
      "PENDING_MEMBERS",
      "Everyone named in the agreement must join before it can take effect",
    );
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
    feeBearer(c, r.feeBearerId!);
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
  replacedAdvance(c, r);
}
/** What the advance in force has already recouped (0 when nothing is in force). */
function recoupedInForce(c: Collaboration): {
  advance?: Advance;
  cents: number;
} {
  const advance = c.versions.find((v) => v.id === c.activeVersionId)?.rules
    .advance;
  if (!advance || !Object.hasOwn(c.recoupedByAdvance, advance.id))
    return { advance, cents: 0 };
  return { advance, cents: c.recoupedByAdvance[advance.id] };
}
/** A revision replacing the advance in force (new ID) must not reset or undercut what was
 * already repaid. Returns the amount to carry to the new ID; throws when a human must decide. */
function replacedAdvance(c: Collaboration, r: Rules): number {
  const { advance: old, cents: recouped } = recoupedInForce(c);
  if (!old || !r.advance || r.advance.id === old.id || recouped === 0) return 0;
  if (r.advance.recipientId !== old.recipientId)
    fail(
      "ADVANCE_RECIPIENT_CHANGED",
      "Part of the advance was already paid back to someone else. Changing who it belongs to needs to be settled outside Fairshare first.",
    );
  if (r.advance.amountCents < recouped)
    fail(
      "ADVANCE_BELOW_RECOUPED",
      `The advance can't be less than the ${recouped} cents already paid back.`,
    );
  if (
    Object.hasOwn(c.recoupedByAdvance, r.advance.id) &&
    c.recoupedByAdvance[r.advance.id] !== recouped
  )
    fail(
      "ADVANCE_CHANGED",
      "This advance ID was already used with different repayments; use a new ID",
    );
  return recouped;
}
/** Moves the repaid amount onto a replacement advance ID before its rules take effect. */
function carryRecoupment(out: Collaboration, next: Rules) {
  const carried = replacedAdvance(out, next);
  if (carried && next.advance)
    Object.defineProperty(out.recoupedByAdvance, next.advance.id, {
      value: carried,
      enumerable: true,
      writable: true,
      configurable: true,
    });
}
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
function sameCalendarDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  // Rejects rollover such as 2023-02-29 -> 2023-03-01 and impossible months.
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}
function calendarDate(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !CALENDAR_DATE.test(value) ||
    Number(value.slice(0, 4)) < 1900 ||
    !sameCalendarDate(value)
  )
    fail("INVALID_DATE", `${label} must be a real calendar date (YYYY-MM-DD)`);
  return value as string;
}
/** Details for any agreement; legacy agreements without details are USD. */
export function agreementDetails(c: Collaboration): AgreementDetails {
  return c.details ? copy(c.details) : { currency: Currency.USD };
}
/** Validates untrusted details and returns a normalized copy. */
export function validateAgreementDetails(input: unknown): AgreementDetails {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("INVALID_INPUT", "Agreement details must be an object");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["currency", "effectiveFrom", "effectiveTo"].includes(key),
    )
  )
    fail("INVALID_INPUT", "Unknown agreement detail");
  if (!Object.values(Currency).includes(value.currency as Currency))
    fail(
      "INVALID_CURRENCY",
      `Currency must be one of: ${Object.values(Currency).join(", ")}`,
    );
  const details: AgreementDetails = { currency: value.currency as Currency };
  if (value.effectiveFrom !== undefined)
    details.effectiveFrom = calendarDate(value.effectiveFrom, "Start date");
  if (value.effectiveTo === null) details.effectiveTo = null;
  else if (value.effectiveTo !== undefined)
    details.effectiveTo = calendarDate(value.effectiveTo, "End date");
  if (
    details.effectiveFrom &&
    details.effectiveTo &&
    details.effectiveTo < details.effectiveFrom
  )
    fail("INVALID_DATE_RANGE", "End date must be on or after the start date");
  return details;
}
/** Organizer-only merge of a details patch; omitted fields keep their value. */
export function updateAgreementDetails(
  c: Collaboration,
  patch: AgreementDetailsPatch,
  actorId: string,
): Collaboration {
  organizer(c, actorId);
  const next = copy(c);
  next.details = validateAgreementDetails({
    ...agreementDetails(c),
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  });
  return next;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A placeholder ID always pairs with its invitation, and only collaborators can be pending. */
function pendingShape(m: Member) {
  const placeholder = m.userId.startsWith(PENDING_USER_PREFIX);
  if (!m.pending) {
    if (placeholder)
      fail("INVALID_MEMBERS", "Placeholder IDs are only for invited people");
    return;
  }
  nonempty(m.pending.invitationId, "Invitation");
  if (
    typeof m.pending.email !== "string" ||
    m.pending.email.length > 254 ||
    !EMAIL.test(m.pending.email) ||
    m.userId !== pendingUserId(m.pending.invitationId) ||
    m.role !== MemberRole.COLLABORATOR
  )
    fail("INVALID_MEMBERS", "Invited people need a valid invitation and email");
}
export function createCollaboration(
  input: {
    id: string;
    name: string;
    members: Member[];
    details?: AgreementDetails;
  },
  actorId: string,
  at: string,
): Collaboration {
  nonempty(input.id, "ID");
  nonempty(input.name, "Name");
  timestamp(at);
  const details =
    input.details === undefined
      ? undefined
      : validateAgreementDetails(input.details);
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
    pendingShape(m);
    ids.add(m.userId);
  }
  if (input.members.filter((m) => m.role === MemberRole.ORGANIZER).length !== 1)
    fail("INVALID_MEMBERS", "Exactly one organizer required");
  const c: Collaboration = {
    ...copy(input),
    ...(details ? { details } : {}),
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
/** True once any rules were sent for approval (or switched on); the people list is then fixed. */
export function rulesEverSent(c: Collaboration): boolean {
  return (
    c.activeVersionId !== undefined ||
    c.versions.some((v) =>
      [VersionStatus.AWAITING_APPROVAL, VersionStatus.ACTIVE].includes(
        v.status,
      ),
    ) ||
    c.audit.some((e) => e.type === AuditType.SENT_FOR_REVIEW)
  );
}
function membersOpen(c: Collaboration) {
  if (rulesEverSent(c))
    fail("MEMBERS_LOCKED", "People can only change before the rules are sent");
}
/** Organizer may still change who is in the agreement (rules never sent). */
export function assertMembersEditable(c: Collaboration, actorId: string): void {
  organizer(c, actorId);
  membersOpen(c);
}
/** Organizer adds a person who already belongs to the workspace. Idempotent. */
export function addMember(
  c: Collaboration,
  person: { userId: string; displayName: string },
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  membersOpen(c);
  if (c.members.some((m) => m.userId === person.userId)) return copy(c);
  const next = copy(c);
  const added: Member = {
    userId: person.userId,
    displayName: person.displayName,
    role: MemberRole.COLLABORATOR,
  };
  memberShape(next, added);
  next.members.push(added);
  audit(next, AuditType.PERSON_ADDED, actorId, at, { userId: person.userId });
  return next;
}
function memberShape(c: Collaboration, m: Member) {
  nonempty(m.userId, "User ID");
  nonempty(m.displayName, "Name");
  if (m.displayName.length > 200)
    fail("INVALID_INPUT", "Name is required and bounded");
  pendingShape(m);
  if (c.members.length >= 100)
    fail("INVALID_MEMBERS", "1–100 members required");
}
/** Organizer names someone who has not joined yet. Rules may give them a share straight away. */
export function addPendingMember(
  c: Collaboration,
  person: { invitationId: string; name: string; email: string },
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  membersOpen(c);
  if (typeof person.email !== "string")
    fail("INVALID_MEMBERS", "Invited people need a valid invitation and email");
  const email = person.email.trim().toLowerCase();
  if (c.members.some((m) => m.pending?.email === email))
    fail("DUPLICATE_PERSON", "This email is already in the agreement");
  const next = copy(c);
  const added: Member = {
    userId: pendingUserId(person.invitationId),
    displayName: person.name?.trim(),
    role: MemberRole.COLLABORATOR,
    pending: { invitationId: person.invitationId, email },
  };
  memberShape(next, added);
  if (next.members.some((m) => m.userId === added.userId))
    fail("DUPLICATE_PERSON", "This invitation is already in the agreement");
  next.members.push(added);
  audit(next, AuditType.PERSON_ADDED, actorId, at, {
    invitationId: person.invitationId,
  });
  return next;
}
/** Organizer removes a collaborator (joined or pending) before the rules are sent. */
export function removeMember(
  c: Collaboration,
  userId: string,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  membersOpen(c);
  const target = member(c, userId);
  if (target.role === MemberRole.ORGANIZER)
    fail("FORBIDDEN", "The organizer cannot be removed");
  const next = copy(c);
  next.members = next.members.filter((m) => m.userId !== userId);
  if (next.organizerHandover?.toUserId === userId)
    delete next.organizerHandover;
  audit(
    next,
    AuditType.PERSON_REMOVED,
    actorId,
    at,
    target.pending ? { invitationId: target.pending.invitationId } : { userId },
  );
  return next;
}
/** Every place an aggregate stores a user ID. Pure; used when an invited person joins. */
export function replaceUserId(
  c: Collaboration,
  from: string,
  to: string,
): Collaboration {
  nonempty(from, "User ID");
  nonempty(to, "User ID");
  const next = copy(c);
  const swap = (id: string) => (id === from ? to : id);
  for (const m of next.members) m.userId = swap(m.userId);
  for (const v of next.versions) {
    for (const s of v.rules.shares) s.userId = swap(s.userId);
    if (v.rules.feeBearerId !== undefined)
      v.rules.feeBearerId = swap(v.rules.feeBearerId);
    if (v.rules.advance)
      v.rules.advance.recipientId = swap(v.rules.advance.recipientId);
    const approvals: Record<string, string> = {};
    for (const [id, when] of Object.entries(v.approvals))
      Object.defineProperty(approvals, swap(id), {
        value: when,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    v.approvals = approvals;
    for (const r of v.changeRequests) r.userId = swap(r.userId);
  }
  for (const r of next.revenue)
    for (const a of r.allocations) a.userId = swap(a.userId);
  for (const e of next.audit) {
    e.actorId = swap(e.actorId);
    if (typeof e.details.userId === "string")
      e.details.userId = swap(e.details.userId);
  }
  return next;
}
/** Organizer replaces an invited person's link (lost or expired). Allowed after sending too,
 * because it does not change who is in the agreement; the placeholder follows the new invitation. */
export function reissuePendingInvite(
  c: Collaboration,
  userId: string,
  invitationId: string,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  const seat = member(c, userId);
  if (!seat.pending)
    fail("NOT_PENDING", "This person has already joined the agreement");
  nonempty(invitationId, "Invitation");
  const nextId = pendingUserId(invitationId);
  if (c.members.some((m) => m.userId === nextId))
    fail("DUPLICATE_PERSON", "This invitation is already in the agreement");
  const next = replaceUserId(c, userId, nextId);
  next.members.find((m) => m.userId === nextId)!.pending!.invitationId =
    invitationId;
  audit(next, AuditType.INVITE_REISSUED, actorId, at, {
    invitationId,
    replacesInvitationId: seat.pending.invitationId,
  });
  return next;
}
/** The invited person joined: their placeholder becomes their real user ID everywhere. */
export function bindPendingMember(
  c: Collaboration,
  invitationId: string,
  user: { id: string; displayName: string },
  at: string,
): Collaboration {
  const seat =
    c.members.find((m) => m.pending?.invitationId === invitationId) ??
    fail("NOT_FOUND", "This person is no longer in the agreement");
  nonempty(user.id, "User ID");
  nonempty(user.displayName, "Name");
  if (user.id.startsWith(PENDING_USER_PREFIX))
    fail("INVALID_INPUT", "A real user is required");
  if (c.members.some((m) => m.userId === user.id))
    fail("ALREADY_MEMBER", "You are already in this agreement");
  const next = replaceUserId(c, seat.userId, user.id);
  const joined = next.members.find((m) => m.userId === user.id)!;
  delete joined.pending;
  joined.displayName = user.displayName;
  audit(next, AuditType.PERSON_JOINED, user.id, at, { invitationId });
  return next;
}
/** Organizer offers the role to another joined member. Offering again replaces the open offer. */
export function offerOrganizerHandover(
  c: Collaboration,
  toUserId: string,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  timestamp(at);
  if (toUserId === actorId)
    fail("INVALID_INPUT", "You are already the organizer");
  actor(c, toUserId);
  const next = copy(c);
  next.organizerHandover = { fromUserId: actorId, toUserId, at };
  audit(next, AuditType.ORGANIZER_HANDOVER_OFFERED, actorId, at, {
    toUserId,
  });
  return next;
}
function openHandover(c: Collaboration): OrganizerHandover {
  return (
    c.organizerHandover ??
    fail("NO_HANDOVER", "There is no open offer to take over organizing")
  );
}
/** Organizer withdraws the open offer. */
export function cancelOrganizerHandover(
  c: Collaboration,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  const offer = openHandover(c);
  const next = copy(c);
  delete next.organizerHandover;
  audit(next, AuditType.ORGANIZER_HANDOVER_CANCELLED, actorId, at, {
    toUserId: offer.toUserId,
  });
  return next;
}
function offeredTo(c: Collaboration, actorId: string): OrganizerHandover {
  actor(c, actorId);
  const offer = openHandover(c);
  if (offer.toUserId !== actorId)
    fail("FORBIDDEN", "This offer was made to someone else");
  return offer;
}
/** The person offered the role says no; nothing else changes. */
export function declineOrganizerHandover(
  c: Collaboration,
  actorId: string,
  at: string,
): Collaboration {
  const offer = offeredTo(c, actorId);
  const next = copy(c);
  delete next.organizerHandover;
  audit(next, AuditType.ORGANIZER_HANDOVER_DECLINED, actorId, at, {
    fromUserId: offer.fromUserId,
  });
  return next;
}
/** The person offered the role takes it: roles swap and nothing else changes. Shares,
 * advance, fee bearer and approvals stay exactly as they were. */
export function acceptOrganizerHandover(
  c: Collaboration,
  actorId: string,
  at: string,
): Collaboration {
  const offer = offeredTo(c, actorId);
  if (member(c, offer.fromUserId).role !== MemberRole.ORGANIZER)
    fail("NO_HANDOVER", "This offer is no longer valid");
  const next = copy(c);
  for (const m of next.members)
    if (m.userId === offer.fromUserId) m.role = MemberRole.COLLABORATOR;
    else if (m.userId === actorId) m.role = MemberRole.ORGANIZER;
  delete next.organizerHandover;
  audit(next, AuditType.ORGANIZER_HANDED_OVER, actorId, at, {
    fromUserId: offer.fromUserId,
    toUserId: actorId,
  });
  return next;
}
export function proposeVersion(
  c: Collaboration,
  rules: Rules,
  actorId: string,
  at: string,
): Collaboration {
  actor(c, actorId);
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
  actor(c, actorId);
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (v.status !== VersionStatus.DRAFT) fail("INVALID_STATE", "Draft required");
  // The people list may have changed since this draft was written.
  validateRules(c, v.rules);
  // An advance that isn't paid yet can still be sent and approved; it must be
  // confirmed before the rules switch on (see confirmAdvancePaid).
  if (v.rules.unresolvedQuestions.length)
    fail("UNRESOLVED_RULES", "Resolve questions first");
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
  actor(c, actorId);
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
const everyoneApproved = (c: Collaboration, v: AgreementVersion) =>
  v.status === VersionStatus.AWAITING_APPROVAL &&
  !c.members.some((m) => m.pending) &&
  c.members.every((m) => Object.hasOwn(v.approvals, m.userId));
/** An advance in these rules that nobody has confirmed as paid yet. */
const advanceUnconfirmed = (v: AgreementVersion) =>
  !!v.rules.advance && !v.rules.advance.verified;
function switchOn(
  out: Collaboration,
  v: AgreementVersion,
  actorId: string,
  at: string,
  automatic: boolean,
) {
  // Re-checked here: payments may have arrived since the revision was proposed.
  carryRecoupment(out, v.rules);
  if (out.activeVersionId)
    out.versions.find((old) => old.id === out.activeVersionId)!.status =
      VersionStatus.SUPERSEDED;
  v.status = VersionStatus.ACTIVE;
  out.activeVersionId = v.id;
  audit(
    out,
    AuditType.ACTIVATED,
    actorId,
    at,
    automatic ? { versionId: v.id, automatic: true } : { versionId: v.id },
  );
}
/** Approve; when this was the last approval needed, the rules switch on in the same transition. */
export function approveAndSwitchOn(
  c: Collaboration,
  versionId: number,
  actorId: string,
  at: string,
): Collaboration {
  const out = approveVersion(c, versionId, actorId, at);
  const v = latestVersion(out, versionId);
  // Approved but the advance isn't confirmed paid: it waits, approved, until it is.
  if (everyoneApproved(out, v) && !advanceUnconfirmed(v))
    switchOn(out, v, actorId, at, true);
  return out;
}
/** Organizer's one-shot send: propose, approve as the sender, send, and switch on if nobody else must approve. */
export function submitForApproval(
  c: Collaboration,
  rules: Rules,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  let out = proposeVersion(c, rules, actorId, at);
  const id = out.versions.at(-1)!.id;
  out = sendForReview(out, id, actorId, at);
  return approveAndSwitchOn(out, id, actorId, at);
}
export function requestChange(
  c: Collaboration,
  versionId: number,
  reason: string,
  actorId: string,
  at: string,
): Collaboration {
  actor(c, actorId);
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
/** Manual switch-on. Optional now that the last approval switches rules on; repeating it is a no-op. */
export function activateVersion(
  c: Collaboration,
  versionId: number,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  const out = copy(c);
  const v = latestVersion(out, versionId);
  if (v.status === VersionStatus.ACTIVE && out.activeVersionId === v.id)
    return out;
  noPendingMembers(out);
  if (!everyoneApproved(out, v))
    fail(
      "APPROVALS_REQUIRED",
      "Every participant must approve this exact version",
    );
  if (advanceUnconfirmed(v))
    fail(
      "ADVANCE_UNCONFIRMED",
      "Confirm the advance is paid before the agreement switches on",
    );
  switchOn(out, v, actorId, at, false);
  return out;
}
/**
 * Organizer confirms the advance in the current proposal was paid. The terms everyone
 * approved already say it was put in upfront, so this records a fact, not a new version:
 * approvals stand. When everyone has approved, the rules switch on in the same transition.
 */
export function confirmAdvancePaid(
  c: Collaboration,
  advanceId: string,
  actorId: string,
  at: string,
): Collaboration {
  organizer(c, actorId);
  nonempty(advanceId, "Advance ID");
  const out = copy(c);
  const v = out.versions.at(-1);
  if (
    !v ||
    ![VersionStatus.DRAFT, VersionStatus.AWAITING_APPROVAL].includes(v.status)
  )
    fail("INVALID_STATE", "No agreement waiting on an advance");
  const advance = v!.rules.advance;
  if (!advance || advance.id !== advanceId)
    fail("STALE_VERSION", "This advance is not in the current agreement");
  if (advance!.verified) return out;
  advance!.verified = true;
  audit(out, AuditType.ADVANCE_CONFIRMED, actorId, at, {
    versionId: v!.id,
    advanceId,
  });
  if (everyoneApproved(out, v!)) switchOn(out, v!, actorId, at, true);
  return out;
}
/** A private draft can be thrown away only by its organizer, before anything was sent or paid. */
export function assertDraftDeletable(c: Collaboration, actorId: string): void {
  organizer(c, actorId);
  if (rulesEverSent(c))
    fail("NOT_A_DRAFT", "Agreements that were sent for approval are kept");
  if (c.revenue.length)
    fail("NOT_A_DRAFT", "Agreements with payments are kept");
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
  const compareRows = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.userId < b.userId) return -1;
    if (a.userId > b.userId) return 1;
    return 0;
  };
  rows.sort(compareRows);
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
/** The money maths for one payment under one set of rules. Pure: no collaboration,
 * no persistence. `recoupedCents` is what the advance has already recouped. */
export function computeAllocations(
  r: Rules,
  input: { grossCents: number; feeCents: number },
  recoupedCents = 0,
): { allocations: Allocation[]; recoupmentCents: number; netCents: number } {
  cents(input.grossCents, "Gross");
  cents(input.feeCents, "Fee");
  cents(recoupedCents, "Recouped");
  if (!input.grossCents || input.feeCents > input.grossCents)
    fail("INVALID_MONEY", "Valid positive USD capture and fee required");
  const net = input.grossCents - input.feeCents;
  const base = r.feePolicy === FeePolicy.BEFORE_SPLIT ? net : input.grossCents;
  const recoupment = r.advance
    ? Math.min(base, Math.max(0, r.advance.amountCents - recoupedCents))
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
  return { allocations, recoupmentCents: recoupment, netCents: net };
}
/** Call only after server-side provider verification, never directly from browser claims. */
export function allocateConfirmedRevenue(
  c: Collaboration,
  input: ConfirmedRevenueInput,
  at: string,
): Collaboration {
  noPendingMembers(c);
  return allocate(c, input, at);
}
function allocate(
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
  const paid =
    r.advance && Object.hasOwn(out.recoupedByAdvance, r.advance.id)
      ? out.recoupedByAdvance[r.advance.id]
      : 0;
  const { allocations, recoupmentCents, netCents } = computeAllocations(
    r,
    input,
    paid,
  );
  if (r.advance)
    Object.defineProperty(out.recoupedByAdvance, r.advance.id, {
      value: paid + recoupmentCents,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  out.revenue.push({
    ...copy(input),
    netCents,
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
  actor(c, actorId);
  const scratch = copy(c);
  const v =
    scratch.versions.find((v) => v.id === versionId) ??
    fail("UNKNOWN_VERSION", "Version not found");
  if (scratch.activeVersionId !== versionId) carryRecoupment(scratch, v.rules);
  scratch.activeVersionId = versionId;
  v.status = VersionStatus.ACTIVE;
  scratch.reviewHold = false;
  scratch.revenue = [];
  // Illustrative only, so it also works while invited people have not joined yet.
  const preview = allocate(
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
