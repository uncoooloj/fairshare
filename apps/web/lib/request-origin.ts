/** Exact deployment allowlist plus same-host protection; no wildcard subdomains. */
export function acceptsRequestOrigin(
  origin: string | null,
  host: string,
  configured: string[],
) {
  try {
    const parsed = new URL(origin || "");
    const allowed = configured.map((value) => value.trim()).filter(Boolean);
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      parsed.host === host &&
      (allowed.length === 0 || allowed.includes(parsed.origin))
    );
  } catch {
    return false;
  }
}
