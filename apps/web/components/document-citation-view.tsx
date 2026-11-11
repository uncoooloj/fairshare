"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Version } from "../lib/model";
import {
  citationSummary,
  clauseLabel,
  documentCitations,
  documentPages,
  fromDocument,
  matchesCitationTarget,
  OPEN_CITATION_EVENT,
  type OpenCitationDetail,
  type DocumentCitation,
  pageBlocks,
  pageIndexOf,
  SEARCH_PREFIX,
  searchHighlights,
} from "../lib/document-citations";
import {
  DocumentViewMode,
  documentViewMode,
  PdfLoadState,
} from "../lib/pdf-highlights";
import type { PdfClause } from "./pdf-pages";

/** pdf.js loads only on the client, only when a PDF is shown, and stays out of
 * the server bundle. If its code cannot load, the text pages show instead. */
const PdfPages = dynamic(
  () =>
    import("./pdf-pages")
      .then((module) => module.PdfPages)
      .catch(() => PdfUnavailable),
  { ssr: false, loading: PdfLoading },
);
function PdfLoading() {
  return <p className="dv-pdf-loading muted">Loading the pages…</p>;
}
function PdfUnavailable({ onFail }: { onFail: () => void }) {
  useEffect(onFail, [onFail]);
  return null;
}

const ZOOM_STEPS = [75, 90, 100, 115, 130, 150];

function Icon({ d, size = 16 }: { d: string[]; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
const FILE_ICON = [
  "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
  "M14 2v4a2 2 0 0 0 2 2h4",
  "M16 13H8",
  "M16 17H8",
];

/** The agreement as pages, cited clauses highlighted, with a panel to jump to each. */
export function DocumentCitationView({
  version,
  document,
  fileName,
  nameOf,
  originalUrl,
  pendingCitation,
  citations: suppliedCitations,
  onCitationSelect,
}: {
  version?: Version;
  document: {
    documentId: string;
    text: string;
    provenance?: {
      inputType?: string;
      ocr?: boolean;
      pages?: number | { page: number; start: number; end: number }[];
    };
  };
  /** Shown in the viewer bar. */
  fileName: string;
  nameOf: (userId: string) => string;
  /** The uploaded file through our proxy. A PDF shows as its real pages. */
  originalUrl?: string;
  /** A citation chosen from other terms or another source document, shown once it loads. */
  pendingCitation?: OpenCitationDetail;
  /** Draft Check supplies only citations whose exact saved ranges are valid. */
  citations?: DocumentCitation[];
  /** Lets an embedding surface focus the rule that owns a selected highlight. */
  onCitationSelect?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [pdfState, setPdfState] = useState(PdfLoadState.Loading);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [rendered, setRendered] = useState(0);
  const mode = documentViewMode({
    inputType: document.provenance?.inputType,
    originalUrl,
    pdfState,
  });
  const body = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const all = useMemo(
    () => suppliedCitations ?? documentCitations(version, document),
    [suppliedCitations, version, document],
  );
  // Rules the team typed are not clauses: count them, never cite them.
  const cited = all.filter(fromDocument);
  const added = all.length - cited.length;
  const { pages, paged } = useMemo(
    () => documentPages(document.text, document.provenance?.pages),
    [document],
  );
  const matches = useMemo(
    () => searchHighlights(document.text, query),
    [document.text, query],
  );
  const highlights = [
    ...cited.flatMap((citation) =>
      citation.highlight ? [citation.highlight] : [],
    ),
    ...matches,
  ];
  const pageCount =
    mode === DocumentViewMode.Pdf && pdfPageCount ? pdfPageCount : pages.length;
  const page = pages[Math.min(pageIndex, pages.length - 1)];
  /** Where an offset in the text sits in the pager. PDF pages count from the
   * file, so use the page number the text came from. */
  const indexAt = (offset: number) => {
    const at = pageIndexOf(pages, offset);
    if (at < 0 || mode !== DocumentViewMode.Pdf) return at;
    return paged ? Math.min(pages[at].page, pageCount) - 1 : at;
  };
  const pdfClauses = useMemo<PdfClause[]>(
    () =>
      cited.flatMap((citation) =>
        citation.highlight
          ? [
              {
                id: citation.id,
                quote: citation.highlight.quote,
                page: citation.page,
              },
            ]
          : [],
      ),
    // cited is rebuilt every render; its content only changes with these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all],
  );
  // The current search hit, counted among the hits on its own page.
  const currentHit = matches[hit];
  const pageHit = currentHit
    ? matches.filter(
        (item) =>
          item.start < currentHit.start &&
          indexAt(item.start) === indexAt(currentHit.start),
      ).length
    : -1;
  const blocks = pageBlocks(document.text, page, highlights);
  const focusId = selected ?? (matches.length ? matches[hit]?.id : null);

  useEffect(() => {
    setSelected(null);
    setPageIndex(0);
  }, [document.documentId, version?.id]);
  // Bring the chosen clause or search hit into view once its page is showing.
  useEffect(() => {
    if (!focusId) return;
    const target =
      mode === DocumentViewMode.Pdf && !selected
        ? ".dv-pdf-hit.is-current"
        : `[data-ids~="${focusId}"]`;
    body.current
      ?.querySelector<HTMLElement>(target)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, pageIndex, rendered, mode, selected]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);

  function show(id: string) {
    const citation = cited.find((item) => item.id === id);
    if (!citation?.highlight) return;
    const index =
      mode === DocumentViewMode.Pdf && citation.page
        ? Math.min(citation.page, pageCount) - 1
        : indexAt(citation.highlight.start);
    if (index >= 0) setPageIndex(index);
    setSelected(null);
    requestAnimationFrame(() => setSelected(id));
    onCitationSelect?.(id);
  }
  function select(id: string) {
    setSelected(id);
    onCitationSelect?.(id);
  }
  useEffect(() => {
    if (
      !pendingCitation ||
      !matchesCitationTarget(
        pendingCitation,
        version?.id,
        document.documentId,
      ) ||
      !cited.some(
        (citation) => citation.id === pendingCitation.id && citation.highlight,
      )
    )
      return;
    show(pendingCitation.id);
    // Runs when the requested citation or the loaded document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, document.documentId, pendingCitation, version?.id]);
  // Legacy callers can still ask the currently selected document to show a quote by ID.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<string | OpenCitationDetail>).detail;
      if (typeof detail !== "string") return;
      const id = detail;
      if (!cited.some((citation) => citation.id === id && citation.highlight))
        return;
      event.preventDefault();
      body.current
        ?.closest("section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      show(id);
    };
    window.addEventListener(OPEN_CITATION_EVENT, open);
    return () => window.removeEventListener(OPEN_CITATION_EVENT, open);
  });

  function goToHit(next: number) {
    if (!matches.length) return;
    const index = (next + matches.length) % matches.length;
    setHit(index);
    setSelected(null);
    const at = indexAt(matches[index].start);
    if (at >= 0) setPageIndex(at);
  }

  const chosen = cited.find((citation) => citation.id === selected);
  const tip =
    mode === DocumentViewMode.Pdf
      ? "This is your original file."
      : document.provenance?.ocr
        ? "This is the text we read from a scanned file. Check it against the original."
        : "This is the text we read from your file.";
  const zoomAt = ZOOM_STEPS.indexOf(zoom);
  return (
    <div className="dv-layout">
      <div className="dv-viewer">
        <div className="dv-bar">
          <p className="dv-file">
            <Icon d={FILE_ICON} />
            <span className="dv-file-name">{fileName}</span>
            <span
              className="dv-info"
              tabIndex={0}
              role="img"
              aria-label={tip}
              data-tip={tip}
            >
              i
            </span>
          </p>
          <div className="dv-tools">
            <div className="dv-pager">
              <button
                type="button"
                className="dv-tool"
                aria-label="Previous page"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((value) => value - 1)}
              >
                <Icon d={["m15 18-6-6 6-6"]} />
              </button>
              <span aria-live="polite">
                {pageIndex + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="dv-tool"
                aria-label="Next page"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => setPageIndex((value) => value + 1)}
              >
                <Icon d={["m9 18 6-6-6-6"]} />
              </button>
            </div>
            <div className="dv-zoom">
              <button
                type="button"
                className="dv-tool"
                aria-label="Zoom out"
                disabled={zoomAt <= 0}
                onClick={() => setZoom(ZOOM_STEPS[zoomAt - 1])}
              >
                <Icon d={["M5 12h14"]} />
              </button>
              <span>{zoom}%</span>
              <button
                type="button"
                className="dv-tool"
                aria-label="Zoom in"
                disabled={zoomAt >= ZOOM_STEPS.length - 1}
                onClick={() => setZoom(ZOOM_STEPS[zoomAt + 1])}
              >
                <Icon d={["M5 12h14", "M12 5v14"]} />
              </button>
            </div>
            <button
              type="button"
              className="dv-tool dv-search-toggle"
              aria-label="Search the agreement"
              aria-expanded={searching}
              onClick={() => {
                setSearching((value) => !value);
                setQuery("");
                setHit(0);
              }}
            >
              <Icon
                d={["m21 21-4.3-4.3", "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"]}
              />
            </button>
          </div>
        </div>
        {searching && (
          <div className="dv-search">
            <input
              ref={searchInput}
              type="search"
              aria-label="Find in the agreement"
              placeholder="Find in the agreement"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHit(0);
                setSelected(null);
                const first = searchHighlights(
                  document.text,
                  event.target.value,
                )[0];
                const at = first ? indexAt(first.start) : -1;
                if (at >= 0) setPageIndex(at);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  goToHit(hit + (event.shiftKey ? -1 : 1));
                if (event.key === "Escape") setSearching(false);
              }}
            />
            <span className="dv-search-count" role="status">
              {query.trim().length > 1
                ? matches.length
                  ? `${hit + 1} of ${matches.length}`
                  : "No matches"
                : ""}
            </span>
          </div>
        )}
        <div className="dv-body" ref={body}>
          {mode === DocumentViewMode.Pdf ? (
            <PdfPages
              url={originalUrl!}
              pageNumber={pageIndex + 1}
              zoom={zoom}
              clauses={pdfClauses}
              selected={selected}
              search={{ query, current: pageHit }}
              onSelect={select}
              onReady={(count) => {
                setPdfPageCount(count);
                setPdfState(PdfLoadState.Ready);
                setPageIndex((value) => Math.min(value, count - 1));
              }}
              onFail={() => {
                setPdfState(PdfLoadState.Failed);
                setPageIndex((value) => Math.min(value, pages.length - 1));
              }}
              onPageChange={(number) => setPageIndex(number - 1)}
              onRendered={() => setRendered((value) => value + 1)}
            />
          ) : (
            <article
              className="dv-page"
              aria-label={paged ? `Page ${page.page}` : "Agreement text"}
              style={{ fontSize: `${(15 * zoom) / 100}px` }}
            >
              {blocks.length ? (
                blocks.map((block) => {
                  const clause = block.segments.some((segment) =>
                    segment.ids.some((id) => !id.startsWith(SEARCH_PREFIX)),
                  );
                  return (
                    <p
                      key={block.start}
                      className={clause ? "dv-para is-cited" : "dv-para"}
                    >
                      {block.segments.map((segment) => {
                        const clauseId = segment.ids.find(
                          (id) => !id.startsWith(SEARCH_PREFIX),
                        );
                        const searchHit = segment.ids.some((id) =>
                          id.startsWith(SEARCH_PREFIX),
                        );
                        const ids = segment.ids.join(" ");
                        if (clauseId)
                          return (
                            <button
                              type="button"
                              key={segment.start}
                              className={`dv-mark${searchHit ? " is-hit" : ""}`}
                              data-ids={ids}
                              data-selected={selected === clauseId}
                              aria-pressed={selected === clauseId}
                              onClick={() => select(clauseId)}
                            >
                              {segment.text}
                            </button>
                          );
                        if (searchHit)
                          return (
                            <mark
                              key={segment.start}
                              className={`dv-hit${
                                segment.ids.includes(matches[hit]?.id ?? "")
                                  ? " is-current"
                                  : ""
                              }`}
                              data-ids={ids}
                            >
                              {segment.text}
                            </mark>
                          );
                        return <span key={segment.start}>{segment.text}</span>;
                      })}
                    </p>
                  );
                })
              ) : (
                <p className="dv-para muted">
                  This page has no text we could read.
                </p>
              )}
            </article>
          )}
        </div>
      </div>
      <aside className="dv-clauses" aria-labelledby="dv-clauses-title">
        <h3 id="dv-clauses-title">Cited clauses</h3>
        {cited.length > 0 && <p className="muted">Click one to jump to it.</p>}
        {cited.length > 0 && (
          <ul>
            {cited.map((citation) => {
              const index = citation.highlight
                ? pageIndexOf(pages, citation.highlight.start)
                : -1;
              const clause =
                clauseLabel(citation.reference.clause) || citation.label;
              return (
                <li key={citation.id}>
                  <button
                    type="button"
                    className="dv-clause"
                    disabled={!citation.highlight}
                    aria-pressed={selected === citation.id}
                    onClick={() => show(citation.id)}
                  >
                    <span className="dv-clause-meta">
                      <span className="dv-chip">
                        <Icon d={FILE_ICON} size={12} />
                        {clause}
                      </span>
                      {paged && index >= 0 && (
                        <span>Page {pages[index].page}</span>
                      )}
                    </span>
                    <span className="dv-clause-summary">
                      {citation.summary ??
                        (version
                          ? citationSummary(citation.id, version, nameOf)
                          : citation.label)}
                    </span>
                    {!citation.highlight && (
                      <span className="dv-clause-note">
                        {citation.reference.documentId !== document.documentId
                          ? "From an earlier file"
                          : "We can't find this wording in the text"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!version ? (
          <p className="muted">These appear once you propose a split.</p>
        ) : !cited.length && !added ? (
          <p className="muted">No clauses cited yet.</p>
        ) : null}
        {added > 0 && (
          <p className="dv-added">
            {added === 1
              ? "1 rule was added by you, not from the document"
              : `${added} rules were added by you, not from the document`}
          </p>
        )}
        <p className="sr-only" role="status">
          {chosen
            ? `Showing clause ${clauseLabel(chosen.reference.clause)}`
            : ""}
        </p>
      </aside>
    </div>
  );
}
