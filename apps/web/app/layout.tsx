import type { Metadata } from "next";
export const metadata: Metadata = { title: "Fairshare", description: "The money follows the agreement." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body style={{fontFamily:"system-ui, sans-serif",margin:0,color:"#101010",background:"#fff"}}>{children}</body></html>; }
