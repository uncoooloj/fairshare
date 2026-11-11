import type { Metadata } from "next";
import "./fonts.css";
import "./tokens.css";
import "./globals.css";
import "./review-workbench.css";
import "./design-polish.css";
import "./overview-polish.css";
import "./agreement-polish.css";
import "./settings-polish.css";
import "./document-polish.css";
import "./mobile-polish.css";
import "./document-step.css";
import "./people-step.css";
import "./reading-document.css";
import "./wizard.css";
import "./wizard-check.css";
import "./wizard-questions.css";
import "./collaborator.css";
import "./guided-revise.css";
import "./paypal-connect.css";
import "./review-discussion.css";
import "./table-system.css";
export const metadata: Metadata = {
  title: "Fairshare · The money follows the agreement",
  description: "Agreements, clear allocations and traceable payouts.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
