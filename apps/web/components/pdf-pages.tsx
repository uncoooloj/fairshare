"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  locateAll,
  locateQuote,
  mergeLineBoxes,
  pageSearchOrder,
  type Box,
  type ItemSpan,
} from "../lib/pdf-highlights";

/** A cited clause to mark on the page. */
export interface PdfClause {
  id: string;
  quote: string;
  /** The page our extraction recorded, if one. */
  page?: number;
  attention?: boolean;
}

interface Placed {
  id: string;
  boxes: Box[];
  hit?: boolean;
  current?: boolean;
  attention?: boolean;
}

const SEARCH_ID = "pdf-search-";
/** Widest a page draws at 100%, like a letter page on screen. */
const PAGE_WIDTH = 760;
/** A PDF that has not loaded by now is treated as failed. */
const LOAD_TIMEOUT_MS = 20000;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let library: Promise<PdfJs> | null = null;
/** pdf.js, loaded once, with its worker served as a static file of its own. */
function loadPdfJs() {
  library ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort)
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" },
      );
    return pdfjs;
  });
  library.catch(() => {
    library = null;
  });
  return library;
}

const itemText = (items: unknown[]) =>
  items.map((item) =>
    typeof (item as { str?: unknown }).str === "string"
      ? (item as { str: string }).str
      : "",
  );

function isPdfCleanupError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return /cancel(?:led|ed)?|abort(?:ed)?|destroyed|terminated/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

/** The real pages of an uploaded PDF, one at a time, with cited clauses
 * highlighted where their wording sits on the page. */
export function PdfPages({
  url,
  pageNumber,
  zoom,
  clauses,
  selected,
  search,
  onSelect,
  onReady,
  onFail,
  onPageChange,
  onRendered,
}: {
  /** The original file, through our own authenticated proxy. */
  url: string;
  pageNumber: number;
  zoom: number;
  clauses: PdfClause[];
  selected: string | null;
  /** Search words, and which of this page's matches is the current one. */
  search: { query: string; current: number };
  onSelect: (id: string) => void;
  onReady: (pageCount: number) => void;
  onFail: () => void;
  onPageChange: (pageNumber: number) => void;
  /** Called once the page and its highlights are on screen. */
  onRendered: (pageNumber: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [size, setSize] = useState<{
    width: number;
    height: number;
    scale: number;
  } | null>(null);
  /** The text items of the page on screen, once it has drawn. */
  const [items, setItems] = useState<string[] | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const divs = useRef<HTMLElement[]>([]);
  const callbacks = useRef({ onReady, onFail, onPageChange, onRendered });
  callbacks.current = { onReady, onFail, onPageChange, onRendered };

  useEffect(() => {
    let stale = false;
    let timedOut = false;
    let loaded: PDFDocumentProxy | null = null;
    let loading: ReturnType<PdfJs["getDocument"]> | null = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      void loading?.destroy();
    }, LOAD_TIMEOUT_MS);
    (async () => {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Original not available");
      const data = new Uint8Array(await response.arrayBuffer());
      const pdfjs = await loadPdfJs();
      loading = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        enableXfa: false,
        // Nothing leaves this page: no font, CMap or wasm downloads.
        disableFontFace: false,
        useSystemFonts: true,
      });
      if (stale || timedOut) {
        void loading.destroy();
        throw new DOMException("PDF load was cancelled", "AbortError");
      }
      return loading.promise;
    })()
      .then((document) => {
        loaded = document;
        window.clearTimeout(timeout);
        if (stale) return void document.destroy();
        setPdf(document);
        callbacks.current.onReady(document.numPages);
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        if (!stale && (!isPdfCleanupError(error) || timedOut))
          callbacks.current.onFail();
      });
    return () => {
      stale = true;
      window.clearTimeout(timeout);
      controller.abort();
      void loading?.destroy();
      void loaded?.destroy();
    };
  }, [url]);

  // Fit the page to the space it has; zoom scales from there.
  useLayoutEffect(() => {
    const element = frame.current?.parentElement;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setWidth(
        element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Draw the page and its invisible, selectable text.
  useEffect(() => {
    if (!pdf || !width || !canvas.current || !textLayer.current) return;
    let cancelled = false;
    const tasks: { cancel: () => void }[] = [];
    (async () => {
      const pdfjs = await loadPdfJs();
      const page = await pdf.getPage(
        Math.min(Math.max(pageNumber, 1), pdf.numPages),
      );
      if (cancelled) return;
      setItems(null);
      const base = page.getViewport({ scale: 1 });
      const scale = (Math.min(width, PAGE_WIDTH) / base.width) * (zoom / 100);
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current!;
      const canvasContext = target.getContext("2d");
      if (!canvasContext) throw new Error("PDF canvas is unavailable");
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      setSize({ width: viewport.width, height: viewport.height, scale });
      const render = page.render({
        canvas: target,
        canvasContext,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      tasks.push(render);
      const layer = textLayer.current!;
      layer.replaceChildren();
      const text = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      });
      tasks.push(text);
      await Promise.all([render.promise, text.render()]);
      if (cancelled) return;
      divs.current = text.textDivs;
      setItems([...text.textContentItemsStr]);
    })().catch((error) => {
      if (!cancelled && !isPdfCleanupError(error)) callbacks.current.onFail();
    });
    return () => {
      cancelled = true;
      tasks.forEach((task) => task.cancel());
    };
  }, [pdf, pageNumber, zoom, width]);

  // Turn each quote into boxes over the rendered words.
  useLayoutEffect(() => {
    const host = frame.current;
    if (!host || !items) return;
    if (!items.length) {
      // A scan with no text on the page: show it, without highlights.
      setPlaced([]);
      callbacks.current.onRendered(pageNumber);
      return;
    }
    const origin = host.getBoundingClientRect();
    const boxesOf = (spans: ItemSpan[]) =>
      mergeLineBoxes(
        spans.flatMap(({ item, start, end }) => {
          const node = divs.current[item]?.firstChild;
          if (!node || node.nodeType !== Node.TEXT_NODE) return [];
          const range = document.createRange();
          const length = node.textContent?.length ?? 0;
          range.setStart(node, Math.min(start, length));
          range.setEnd(node, Math.min(end, length));
          return [...range.getClientRects()].map((rect) => ({
            left: rect.left - origin.left,
            top: rect.top - origin.top,
            width: rect.width,
            height: rect.height,
          }));
        }),
      );
    const next: Placed[] = [];
    for (const clause of clauses) {
      const spans = locateQuote(items, clause.quote);
      if (spans.length)
        next.push({
          id: clause.id,
          boxes: boxesOf(spans),
          attention: clause.attention,
        });
    }
    locateAll(items, search.query).forEach((spans, index) =>
      next.push({
        id: `${SEARCH_ID}${index}`,
        boxes: boxesOf(spans),
        hit: true,
        current: index === search.current,
      }),
    );
    setPlaced(next);
    callbacks.current.onRendered(pageNumber);
    // pageNumber is read for the callback only; items change with each page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, clauses, search.query, search.current]);

  // A chosen clause that is not on this page: find the page that has it.
  useEffect(() => {
    if (!pdf || !selected || !items) return;
    if (placed.some((mark) => mark.id === selected && !mark.hit)) return;
    const clause = clauses.find((item) => item.id === selected);
    if (!clause) return;
    let stale = false;
    (async () => {
      for (const number of pageSearchOrder(pdf.numPages, clause.page)) {
        if (number === pageNumber) continue;
        const content = await (await pdf.getPage(number)).getTextContent();
        if (stale) return;
        if (locateQuote(itemText(content.items), clause.quote).length) {
          callbacks.current.onPageChange(number);
          return;
        }
      }
    })().catch((error) => {
      if (!stale && !isPdfCleanupError(error)) callbacks.current.onFail();
    });
    return () => {
      stale = true;
    };
    // Only when the choice or the page changes, not on every highlight pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, selected, pageNumber, items]);

  return (
    <div
      ref={frame}
      className="dv-pdf-page"
      aria-label={`Page ${pageNumber}`}
      role="region"
      style={
        {
          width: size?.width,
          height: size?.height,
          "--total-scale-factor": size?.scale ?? 1,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div ref={textLayer} className="textLayer" />
      {placed.map((mark) =>
        mark.hit ? (
          mark.boxes.map((box, index) => (
            <span
              key={`${mark.id}-${index}`}
              className={`dv-pdf-hit${mark.current ? " is-current" : ""}`}
              data-ids={mark.id}
              style={box}
            />
          ))
        ) : (
          <PdfClauseMark
            key={mark.id}
            mark={mark}
            selected={selected === mark.id}
            onSelect={onSelect}
          />
        ),
      )}
      {!pdf && <p className="dv-pdf-loading muted">Loading the pages…</p>}
    </div>
  );
}

function PdfClauseMark({
  mark,
  selected,
  onSelect,
}: {
  mark: Placed;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  if (!mark.boxes.length) return null;
  const top = Math.min(...mark.boxes.map((box) => box.top));
  const bottom = Math.max(...mark.boxes.map((box) => box.top + box.height));
  const left = Math.min(...mark.boxes.map((box) => box.left));
  return (
    <>
      <span
        className="dv-pdf-bar"
        aria-hidden="true"
        style={{ top, height: bottom - top, left: Math.max(left - 14, 4) }}
      />
      {mark.boxes.map((box, index) => (
        <button
          key={index}
          type="button"
          className={`dv-pdf-mark${mark.attention ? " is-ambiguous" : ""}`}
          aria-label={
            mark.attention ? "Clause needing clarification" : "Cited clause"
          }
          // Only the first band is a tab stop; the rest are the same clause.
          tabIndex={index ? -1 : 0}
          data-ids={mark.id}
          data-selected={selected}
          aria-pressed={selected}
          style={box}
          onClick={() => onSelect(mark.id)}
        />
      ))}
    </>
  );
}
