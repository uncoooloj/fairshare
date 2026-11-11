import type { Metadata } from "next";
import FairshareApp from "../../components/fairshare-app";
export const metadata: Metadata = {
  title: "Workspace · Fairshare",
  robots: { index: false, follow: false },
};
export default function Workspace() {
  return <FairshareApp />;
}
