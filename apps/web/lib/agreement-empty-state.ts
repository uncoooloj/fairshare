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
        "You can view but not approve. Ask whoever invited you if you need more.",
    };
  }

  return {
    title: "No agreements shared with you yet",
    description:
      "Ask the organizer to add you to their agreement, then refresh.",
  };
}
