import { organizerHandoverOf } from "../lib/agreement-api";
import type { Agreement } from "../lib/model";
import type { Mutate, Run } from "./sections/types";
import { Button } from "./ui";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Shown only to the person the organizer asked to take over organizing. */
export function OrganizerHandoverBanner({
  agreement,
  userId,
  busy,
  run,
  mutate,
}: {
  agreement: Agreement;
  userId: string;
  busy: boolean;
  run: Run;
  mutate: Mutate;
}) {
  const offer = organizerHandoverOf(agreement);
  if (!offer || offer.toUserId !== userId) return null;
  const from = agreement.value.members.find(
    (m) => m.userId === offer.fromUserId,
  );
  const name = from ? firstName(from.displayName) : "The organizer";
  return (
    <section
      className="notice ag-handover-banner"
      aria-label="Take over organizing"
    >
      <p>
        <strong>
          {name} wants you to take over organizing {agreement.value.name}
        </strong>
      </p>
      <p>
        You’d add people, send changes and look after payments. The split
        doesn’t change.
      </p>
      <div className="collab-drawer-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => mutate("/organizer-transfer/decline"))}
        >
          Decline
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => run(() => mutate("/organizer-transfer/accept"))}
        >
          Accept
        </Button>
      </div>
    </section>
  );
}
