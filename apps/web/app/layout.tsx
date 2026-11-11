import type { Metadata } from "next";
import "./fonts.css";
import "./tokens.css";
import "./globals.css";
import "./review-workbench.css";
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
