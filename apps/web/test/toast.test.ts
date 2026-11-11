import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Toast, TOAST_DURATION_MS } from "../components/toast";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("toast reserves a polite live region without adding content or focus targets", () => {
  const empty = renderToStaticMarkup(createElement(Toast, { toast: null }));
  assert.match(empty, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(empty, /class="toast"|button|tabindex|autofocus/);
});

test("copy confirmation is an accessible, non-interactive success toast", () => {
  for (const message of ["Message copied", "Link copied"]) {
    const html = renderToStaticMarkup(
      createElement(Toast, { toast: { id: 1, message } }),
    );
    assert.match(html, /class="toast"/);
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    assert.ok(html.includes(`<span>${message}</span>`));
    assert.doesNotMatch(html, /button|tabindex|autofocus/);
  }
});

test("each copy replaces the confirmation and restarts a cleaned-up dismissal timer", () => {
  const component = source("../components/toast.tsx");
  assert.equal(TOAST_DURATION_MS, 4000);
  assert.match(
    component,
    /setToast\(\{ id: \+\+sequence.current, message \}\)/,
  );
  assert.match(
    component,
    /setTimeout\(\(\) => setToast\(null\), TOAST_DURATION_MS\)/,
  );
  assert.match(component, /return \(\) => clearTimeout\(timer\)/);
  assert.match(component, /\}, \[toast\]\)/);
  assert.match(component, /key=\{toast.id\}/);
});

test("People and Nudge use one toast per surface, including inside the native dialog", () => {
  const people = source("../components/agreement-people.tsx");
  const share = source("../components/person-share.tsx");
  for (const component of [people, share]) {
    assert.match(component, /const \{ toast, showToast \} = useToast\(\)/);
    assert.match(component, /onCopied=\{showToast\}/);
    assert.match(component, /<Toast toast=\{toast\} \/>/);
  }
  assert.match(share, /<Toast toast=\{toast\} \/>\s*<\/Drawer>/);
  assert.match(
    share,
    /outcome === ShareOutcome.Copied\)\s*onCopied\(mode === ShareMode.Nudge \? "Message copied" : "Link copied"\)/,
  );
  assert.doesNotMatch(share, /setNotice\([^;]*(Message copied|Link copied)/);
  assert.match(
    share,
    /setManual\(text\);\s*setNotice\("Copy it from the box below\."\)/,
  );
  assert.match(share, /ShareOutcome.Shared\) setNotice\("Shared"\)/);
});

test("toast floats without shifting rows, respects safe areas and reduced motion", () => {
  const css = source("../app/toast.css");
  assert.match(css, /\.toast-region \{\s*position: fixed/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /max-width: 100%/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
  );
  assert.match(source("../app/layout.tsx"), /import "\.\/toast.css"/);
});
