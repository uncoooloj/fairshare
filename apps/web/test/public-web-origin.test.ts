import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PUBLIC_WEB_ORIGIN,
  publicWebOrigin,
} from "../lib/public-web-origin";

test("public links use the custom domain from either production entry point", () => {
  assert.equal(
    publicWebOrigin("https://fairshare-web.udaleamehoj.workers.dev"),
    DEFAULT_PUBLIC_WEB_ORIGIN,
  );
  assert.equal(
    publicWebOrigin("https://usefairshare.app"),
    DEFAULT_PUBLIC_WEB_ORIGIN,
  );
});

test("loopback and other self-hosted origins stay unchanged", () => {
  assert.equal(
    publicWebOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    publicWebOrigin("http://127.0.0.1:3000"),
    "http://127.0.0.1:3000",
  );
  assert.equal(
    publicWebOrigin("https://preview.fairshare.example"),
    "https://preview.fairshare.example",
  );
});
