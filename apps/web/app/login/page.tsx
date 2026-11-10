import type { Metadata } from "next";
import FairshareApp from "../../components/fairshare-app";
export const metadata: Metadata = {
  title: "Log in · Fairshare",
  robots: { index: false, follow: false },
};
export default function Login() {
  return <FairshareApp />;
}
