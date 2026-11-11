/** Membership alone does not grant access to any particular agreement. */
export function agreementEmptyState(workspaceRole?: string) {
  if (workspaceRole === "OWNER") {
    return {
      title: "Your first agreement starts here",
      description:
        "Create an agreement, bring in your collaborators and make the split clear before money comes in.",
    };
  }

  if (workspaceRole === "VIEWER") {
    return {
      title: "No agreements shared with you yet",
      description:
        "You have read-only access. Ask the person who invited you if you need to participate in an agreement.",
    };
  }

  return {
    title: "No agreements shared with you yet",
    description:
      "Your invitation is accepted. Ask the organizer to add you to the agreement, then choose Refresh to see it here. You do not need to upload another copy.",
  };
}
