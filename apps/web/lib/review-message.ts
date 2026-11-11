export function reviewMessage(
  agreementName: string,
  versionId: number,
  note: string,
  origin: string,
) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("A valid app URL is required.");
  const message = note.trim();
  if (message.length > 1000)
    throw new Error("Keep your review note under 1,000 characters.");
  return [
    message,
    `Please review version ${versionId} of “${agreementName}” in Fairshare.`,
    "Sign in with the email I invited.",
    new URL("/app", url.origin).href,
  ]
    .filter(Boolean)
    .join("\n\n");
}
