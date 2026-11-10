import { pathToFileURL } from "node:url";

export function validateCloudflareEnvironment(env) {
  const errors = [];
  for (const key of ["FAIRSHARE_API_URL", "FAIRSHARE_WEB_ORIGIN"]) {
    try {
      const url = new URL(env[key] || "");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        throw new Error();
      }
      if (
        url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname.endsWith(".trycloudflare.com") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
        url.hostname.startsWith("[")
      ) {
        throw new Error();
      }
    } catch {
      errors.push(
        `${key} must be a stable HTTPS origin without credentials, path or query.`,
      );
    }
  }
  // This is an operator acknowledgement, not proof. Restart/restore acceptance is separate.
  if (env.FAIRSHARE_API_PERSISTENCE_VERIFIED !== "true") {
    errors.push(
      "Verify API restart/redeploy persistence before setting FAIRSHARE_API_PERSISTENCE_VERIFIED=true.",
    );
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = validateCloudflareEnvironment(process.env);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(
      "Origin/persistence acknowledgement checks passed; deployment and provider acceptance remain separate.",
    );
  }
}
