import type { Metadata } from "next";
import { PayPalReturn } from "../../../components/paypal-return";

// The URL carries a one-time PayPal code; never send it as a referrer.
export const metadata: Metadata = { referrer: "no-referrer" };
export default function Page() {
  return <PayPalReturn />;
}
