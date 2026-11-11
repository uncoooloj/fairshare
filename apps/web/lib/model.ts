import { errorCopy } from "./error-copy";
export enum Section {
  Overview = "Overview",
  Agreements = "Agreements",
  Payouts = "Payouts",
  Settings = "Settings",
}
export enum AgreementTab {
  Overview = "Overview",
  Terms = "Terms",
  People = "People",
  Document = "Document",
  Payments = "Payments",
  Allocations = "Allocations",
}
export interface Member {
  userId: string;
  displayName: string;
  role: string;
}
export interface Allocation {
  userId: string;
  recoupmentCents: number;
  shareCents: number;
  feeCents: number;
  /** Refund recovery kept from this payment after the recorded split. */
  offsetCents?: number;
  /** Refund recovery returned to this payment after the recorded split. */
  creditCents?: number;
  totalCents: number;
  status: string;
}
export interface Rules {
  currency: "USD";
  shares: { userId: string; basisPoints: number }[];
  feePolicy: string;
  feeBearerId?: string;
  advance?: {
    id: string;
    recipientId: string;
    amountCents: number;
    verified: boolean;
    source: Source;
  };
  source: Source;
  unresolvedQuestions: string[];
}
export interface Source {
  origin: string;
  documentId: string;
  clause: string;
  excerpt: string;
}
export interface Version {
  id: number;
  status: string;
  rules: Rules;
  approvals: Record<string, string>;
  changeRequests: { userId: string; reason: string; at: string }[];
}
export interface Revenue {
  providerCaptureId: string;
  currency: "USD";
  grossCents: number;
  feeCents: number;
  netCents: number;
  at: string;
  versionId: number;
  status: string;
  allocations: Allocation[];
}
/** Agreement metadata currency; payments and payouts remain USD-only. */
export enum Currency {
  USD = "USD",
}
/** Dates are YYYY-MM-DD. effectiveTo null = no end date; undefined = not set.
 * Agreements created before details existed omit it; treat as { currency: USD }. */
export interface AgreementDetails {
  currency: Currency;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}
export interface Agreement {
  workspaceId: string;
  id: string;
  revision: number;
  value: {
    name: string;
    details?: AgreementDetails;
    members: Member[];
    versions: Version[];
    activeVersionId?: number;
    revenue: Revenue[];
    recoupedByAdvance: Record<string, number>;
    reviewHold: boolean;
    audit: { sequence: number; type: string; at: string; actorId: string }[];
  };
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export { formatMoney as money } from "./preferences";
export function parseCents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 1e12)
    throw new Error("Amount is outside the supported range.");
  return cents;
}
export function parseShare(value: string) {
  const n = parseCents(value);
  if (n > 10000) throw new Error("A share cannot exceed 100%.");
  return n;
}
export const title = (s: string) =>
  s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/service/" + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      errorCopy(res.status, data.error?.code, data.error?.message),
      res.status,
      data.error?.code,
    );
  return data;
}
export const sampleAgreement =
  "Maya, Jordan and Riley agree that eligible revenue is split 50% to Maya, 30% to Jordan and 20% to Riley, after recouping a previously paid $2,000 advance to Maya. Processing fees are to be agreed by all participants before activation.";
