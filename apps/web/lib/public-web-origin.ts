/** Public links use the verified custom domain when opened through the retained Workers URL. */
export const DEFAULT_PUBLIC_WEB_ORIGIN = "https://usefairshare.app";
const RETAINED_WORKERS_ORIGIN = "https://fairshare-web.udaleamehoj.workers.dev";

export function publicWebOrigin(currentOrigin: string) {
  try {
    const url = new URL(currentOrigin);
    return url.origin === RETAINED_WORKERS_ORIGIN
      ? DEFAULT_PUBLIC_WEB_ORIGIN
      : url.origin;
  } catch {
    return DEFAULT_PUBLIC_WEB_ORIGIN;
  }
}
