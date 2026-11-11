import { readFileSync } from "node:fs";

/**
 * Source files that together make up the signed-in app formerly held in
 * fairshare-app.tsx. FairshareApp comes first so handler-order assertions that
 * split on its function boundaries still read its code in order.
 */
export const appSourceFiles = [
  "fairshare-app.tsx",
  "app-shell.tsx",
  "sections/overview-section.tsx",
  "sections/agreements-section.tsx",
  "sections/agreement-detail.tsx",
  "sections/agreement-tabs/overview-tab.tsx",
  "sections/agreement-tabs/people-tab.tsx",
  "sections/agreement-tabs/terms-tab.tsx",
  "sections/agreement-tabs/payments-tab.tsx",
  "sections/agreement-tabs/payment-breakdown.tsx",
  "sections/payouts-section.tsx",
  "sections/settings-section.tsx",
];

export const readComponent = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

/** The app's components concatenated, for whole-app assertions and counts. */
export const appSource = () => appSourceFiles.map(readComponent).join("\n");
