import type { FastifyRequest } from "fastify";
import {
  acceptOrganizerHandover,
  cancelOrganizerHandover,
  declineOrganizerHandover,
  DomainError,
  offerOrganizerHandover,
} from "@fairshare/domain";
import type {
  AggregateRow,
  AggregateStore,
  FairshareApp,
} from "./fairshare.js";

function expectedRevision(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1)
    throw new DomainError("INVALID_INPUT", "expectedRevision required");
  return n;
}

/** Handing the organizer role to another joined member. The organizer offers (or withdraws),
 * the named person accepts or declines. In-app only; nothing is emailed. Shares, advance,
 * fee bearer and approvals never change. */
export function registerOrganizerHandover(
  app: FairshareApp,
  store: AggregateStore,
  access: (req: FastifyRequest) => {
    p: { workspaceId: string; collaborationId: string };
    user: { id: string };
    row: AggregateRow;
  },
) {
  const path =
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/organizer-transfer";
  const at = () => new Date().toISOString();
  const body = (req: FastifyRequest) =>
    (req.body ?? {}) as Record<string, unknown>;
  app.post(path, async (req) => {
    const { p, user } = access(req);
    const b = body(req);
    if (typeof b.toUserId !== "string" || !b.toUserId.trim())
      throw new DomainError("INVALID_INPUT", "Choose who takes over");
    const toUserId = b.toUserId;
    return store.update(
      p.workspaceId,
      p.collaborationId,
      expectedRevision(b.expectedRevision),
      (c) => offerOrganizerHandover(c, toUserId, user.id, at()),
    );
  });
  app.delete(path, async (req) => {
    const { p, user } = access(req);
    return store.update(
      p.workspaceId,
      p.collaborationId,
      expectedRevision(
        (req.query as Record<string, unknown>)?.expectedRevision,
      ),
      (c) => cancelOrganizerHandover(c, user.id, at()),
    );
  });
  for (const [action, transition] of Object.entries({
    accept: acceptOrganizerHandover,
    decline: declineOrganizerHandover,
  }))
    app.post(`${path}/${action}`, async (req) => {
      const { p, user } = access(req);
      return store.update(
        p.workspaceId,
        p.collaborationId,
        expectedRevision(body(req).expectedRevision),
        (c) => transition(c, user.id, at()),
      );
    });
}
