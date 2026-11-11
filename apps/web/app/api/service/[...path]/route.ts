import { acceptsRequestOrigin } from "../../../../lib/request-origin";
import { getCloudflareContext } from "@opennextjs/cloudflare";
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
  if (
    ![
      "auth",
      "workspaces",
      "invitations",
      "agreements",
      "health",
      "settings",
    ].includes(parts[0])
  )
    return NextResponse.json(
      { error: { message: "Unknown API route" } },
      { status: 404 },
    );
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const requestHost = req.headers.get("host") || new URL(req.url).host;
    const sameOrigin = acceptsRequestOrigin(origin, requestHost, [
      process.env.FAIRSHARE_WEB_ORIGIN || "",
      ...(process.env.FAIRSHARE_WEB_ALTERNATE_ORIGINS || "").split(","),
    ]);
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
  url.search = new URL(req.url).search;
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
      body.length >
        (["pdf", "docx"].includes(parts.at(-1) || "") ||
        parts.join("/") === "agreements/intake"
          ? 7 * 1024 * 1024
          : parts.join("/") === "auth/profile/photo"
            ? 360000
            : 100000)
    )
      return NextResponse.json(
        { error: { message: "Request too large" } },
        { status: 413 },
      );
    let boundApi:
      | {
          fetch(
            input: RequestInfo | URL,
            init?: RequestInit,
          ): Promise<Response>;
        }
      | undefined;
    try {
      boundApi = (
        getCloudflareContext().env as unknown as {
          FAIRSHARE_API?: typeof boundApi;
        }
      ).FAIRSHARE_API;
    } catch {
      // Local Node development has no Workers request context.
    }
    const upstreamFetch: typeof fetch = boundApi
      ? (input, init) => boundApi!.fetch(input, init)
      : fetch;
    const result = await upstreamFetch(url, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
      redirect: "manual",
    });
    if (result.status >= 300 && result.status < 400)
      throw new Error("Unexpected API redirect");
    if (result.ok && req.method === "GET" && parts.at(-1) === "original") {
      const mime = result.headers.get("content-type")?.split(";")[0];
      if (
        mime !== "application/pdf" &&
        mime !==
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
        throw new Error("Unexpected file type");
      const bytes = await result.arrayBuffer();
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new Error("Original exceeds size limit");
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="fairshare-original.${mime === "application/pdf" ? "pdf" : "docx"}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    }
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
      ([
        "auth/email-change/confirm",
        "auth/password",
        "auth/password-reset/confirm",
        "auth/mfa/activate",
        "auth/mfa/disable",
      ].includes(parts.join("/")) &&
        result.ok) ||
      result.status === 401
    )
      response.cookies.delete(COOKIE);
    return response;
  } catch (error) {
    console.error(
      "Fairshare API proxy failed",
      error instanceof Error
        ? {
            name: error.name,
            message: error.message
              .replace(/https?:\/\/[^ ]+/g, "[url]")
              .slice(0, 200),
          }
        : { name: "UnknownError" },
    );
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
