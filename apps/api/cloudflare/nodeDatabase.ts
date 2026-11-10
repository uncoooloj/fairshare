import type { DatabaseBackend } from '../src/database.js';
/** Worker bundles must inject durable storage, never silently fall back to disk. */
export function openNodeDatabase(_path: string): DatabaseBackend {
  throw new Error('Cloudflare requires injected Durable Object SQL storage');
}
