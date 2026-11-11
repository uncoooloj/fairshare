import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DocumentViewMode,
  documentViewMode,
  locateAll,
  locateQuote,
  mergeLineBoxes,
  pageSearchOrder,
  PdfLoadState,
} from "../lib/pdf-highlights";
import { DocumentCitationView } from "../components/document-citation-view";

// pdf.js text items as they come off a page: line pieces, odd spacing, curly quotes.
const items = [
  "4. Revenue",
  " ",
  "4.2 Net revenue is split fifty-fifty between the",
  "",
  "Producer and the Artist, after the Producer’s",
  "advance is paid back.",
  "5. Term",
];

test("a quote maps to the item spans it covers, across line breaks", () => {
  const spans = locateQuote(
    items,
    "Net revenue is split fifty-fifty between the Producer and the Artist",
  );
  assert.deepEqual(spans, [
    { item: 2, start: 4, end: 48 },
    { item: 4, start: 0, end: 23 },
  ]);
});

test("matching ignores case, spacing and curly quotes", () => {
  const spans = locateQuote(
    items,
    "after the producer's\nadvance  is paid back.",
  );
  assert.deepEqual(spans, [
    { item: 4, start: 25, end: 45 },
    { item: 5, start: 0, end: 21 },
  ]);
});

test("a quote that is not on the page is not placed", () => {
  assert.deepEqual(locateQuote(items, "The Label owns the masters."), []);
  assert.deepEqual(locateQuote(items, " "), []);
});

test("near wording never highlights a cited clause", () => {
  assert.deepEqual(
    locateQuote(
      [
        "Net revenue is split fifty-fifty betvveen the Producer and the Artist.",
      ],
      "Net revenue is split fifty-fifty between the Producer and the Artist.",
    ),
    [],
  );
  assert.deepEqual(
    locateQuote(
      ["The Producer owns the masters after the advance is paid back."],
      "The Artist owns the masters after the advance is paid back.",
    ),
    [],
  );
});

test("search finds every match on the page", () => {
  assert.equal(locateAll(items, "producer").length, 2);
  assert.deepEqual(locateAll(items, "a"), []);
});

test("the recorded page is searched first", () => {
  assert.deepEqual(pageSearchOrder(4, 3), [3, 1, 2, 4]);
  assert.deepEqual(pageSearchOrder(2, 9), [1, 2]);
  assert.deepEqual(pageSearchOrder(2), [1, 2]);
});

test("boxes on one line merge into one band; other lines stay apart", () => {
  const merged = mergeLineBoxes([
    { left: 10, top: 100, width: 40, height: 12 },
    { left: 52, top: 101, width: 30, height: 11 },
    { left: 10, top: 116, width: 20, height: 12 },
    { left: 0, top: 0, width: 0, height: 12 },
  ]);
  assert.deepEqual(merged, [
    { left: 10, top: 100, width: 72, height: 12 },
    { left: 10, top: 116, width: 20, height: 12 },
  ]);
});

test("only an uploaded PDF we hold, that loaded, shows as real pages", () => {
  const url = "/api/service/x/documents/d/original";
  const view = (
    inputType: string | undefined,
    pdfState: PdfLoadState,
    originalUrl?: string,
  ) => documentViewMode({ inputType, originalUrl, pdfState });
  assert.equal(view("PDF", PdfLoadState.Loading, url), DocumentViewMode.Pdf);
  assert.equal(view("PDF", PdfLoadState.Ready, url), DocumentViewMode.Pdf);
  assert.equal(view("PDF", PdfLoadState.Failed, url), DocumentViewMode.Text);
  assert.equal(view("PDF", PdfLoadState.Ready), DocumentViewMode.Text);
  assert.equal(view("DOCX", PdfLoadState.Ready, url), DocumentViewMode.Text);
  assert.equal(view("TEXT", PdfLoadState.Ready, url), DocumentViewMode.Text);
  assert.equal(view(undefined, PdfLoadState.Ready, url), DocumentViewMode.Text);
});

test("a Word file renders the text pages; a PDF waits for its pages, not the text", () => {
  const render = (inputType: string) =>
    renderToStaticMarkup(
      createElement(DocumentCitationView, {
        document: {
          documentId: "d",
          text: "Terms\nHalf each.",
          provenance: { inputType },
        },
        fileName: "Deal",
        nameOf: () => "",
        originalUrl: "/api/service/x/documents/d/original",
      }),
    );
  assert.match(render("DOCX"), /Half each\./);
  assert.match(render("PDF"), /Loading the pages/);
  assert.doesNotMatch(render("PDF"), /Half each\./);
});

test("pdf.js loads lazily, from the authenticated proxy, never at module load", () => {
  const view = readFileSync(
    new URL("../components/document-citation-view.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(view, /^import .*pdfjs-dist/m);
  assert.doesNotMatch(view, /^import \{[^}]*\} from "\.\/pdf-pages"/m);
  assert.match(view, /import\("\.\/pdf-pages"\)/);
  const pages = readFileSync(
    new URL("../components/pdf-pages.tsx", import.meta.url),
    "utf8",
  );
  assert.match(pages, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.match(pages, /credentials: "same-origin"/);
  assert.match(pages, /new AbortController\(\)/);
  assert.match(pages, /signal: controller.signal/);
  assert.match(pages, /void loading\?\.destroy\(\)/);
  assert.match(pages, /callbacks\.current\.onFail\(\)/);
  assert.match(pages, /isEvalSupported: false/);
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(pkg.dependencies["pdfjs-dist"], /^\d+\.\d+\.\d+$/);
});
