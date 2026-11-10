import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
const COOKIE = "fairshare_session";
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const parts = (await params).path;
  if (
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || p.includes("/") || p.includes("\\"),
    )
  )
    return NextResponse.json(
      { error: { message: "Invalid path" } },
      { status: 400 },
    );
  if (!["auth", "workspaces", "invitations", "health"].includes(parts[0]))
    return NextResponse.json(
      { error: { message: "Unknown API route" } },
      { status: 404 },
    );
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const requestHost = req.headers.get("host") || new URL(req.url).host;
    let sameOrigin = false;
    try {
      const parsed = new URL(origin || "");
      sameOrigin =
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.host === requestHost &&
        (!process.env.FAIRSHARE_WEB_ORIGIN ||
          parsed.origin === process.env.FAIRSHARE_WEB_ORIGIN);
    } catch {}
    if (!sameOrigin)
      return NextResponse.json(
        { error: { message: "Request origin rejected" } },
        { status: 403 },
      );
  }
  const base = process.env.FAIRSHARE_API_URL || "http://127.0.0.1:3001";
  const url = new URL(
    (parts[0] === "health" ? "/" : "/api/") +
      parts.map(encodeURIComponent).join("/"),
    base,
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = req.cookies.get(COOKIE)?.value;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await req.text();
    if (
      body &&
      body.length > (parts.at(-1) === "pdf" ? 7 * 1024 * 1024 : 100000)
    )
      return NextResponse.json(
        { error: { message: "Request too large" } },
        { status: 413 },
      );
    const result = await fetch(url, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
      redirect: "error",
    });
    const data = await result.json();
    const session = data.token;
    delete data.token;
    const response = NextResponse.json(data, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
    if (result.ok && typeof session === "string")
      response.cookies.set(COOKIE, session, {
        httpOnly: true,
        sameSite: "strict",
        secure: new URL(req.url).protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
    if (
      parts.join("/") === "auth/logout" ||
      (parts.join("/") === "auth/password" && result.ok) ||
      result.status === 401
    )
      response.cookies.delete(COOKIE);
    return response;
  } catch {
    return NextResponse.json(
      {
        error: {
          message:
            "The Fairshare API is unavailable. Your changes have not been confirmed. Please retry or refresh before repeating a payment.",
        },
      },
      { status: 502 },
    );
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
