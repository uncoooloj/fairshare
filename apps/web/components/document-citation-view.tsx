"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Version } from "../lib/model";
import {
  citationSummary,
  clauseLabel,
  documentCitations,
  documentPages,
  fromDocument,
  OPEN_CITATION_EVENT,
  pageBlocks,
  pageIndexOf,
  SEARCH_PREFIX,
  searchHighlights,
} from "../lib/document-citations";

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
}: {
  version?: Version;
  document: {
    documentId: string;
    text: string;
    provenance?: {
      ocr?: boolean;
      pages?: number | { page: number; start: number; end: number }[];
    };
  };
  /** Shown in the viewer bar. */
  fileName: string;
  nameOf: (userId: string) => string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const all = useMemo(
    () => documentCitations(version, document),
    [version, document],
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
  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const blocks = pageBlocks(document.text, page, highlights);
  const focusId = selected ?? (matches.length ? matches[hit]?.id : null);

  useEffect(() => {
    setSelected(null);
    setPageIndex(0);
  }, [document.documentId, version?.id]);
  // Bring the chosen clause or search hit into view once its page is showing.
  useEffect(() => {
    if (!focusId) return;
    body.current
      ?.querySelector<HTMLElement>(`[data-ids~="${focusId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, pageIndex]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);

  function show(id: string) {
    const citation = cited.find((item) => item.id === id);
    if (!citation?.highlight) return;
    const index = pageIndexOf(pages, citation.highlight.start);
    if (index >= 0) setPageIndex(index);
    setSelected(null);
    requestAnimationFrame(() => setSelected(id));
  }
  // A rule's clause chip asks for its quote: show it when it can be found.
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
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
    const at = pageIndexOf(pages, matches[index].start);
    if (at >= 0) setPageIndex(at);
  }

  const chosen = cited.find((citation) => citation.id === selected);
  const tip = document.provenance?.ocr
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
                {pageIndex + 1} / {pages.length}
              </span>
              <button
                type="button"
                className="dv-tool"
                aria-label="Next page"
                disabled={pageIndex >= pages.length - 1}
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
                const at = first ? pageIndexOf(pages, first.start) : -1;
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
                            onClick={() => setSelected(clauseId)}
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
        </div>
      </div>
      <aside className="dv-clauses" aria-labelledby="dv-clauses-title">
        <h3 id="dv-clauses-title">Cited clauses</h3>
        {cited.length > 0 && <p className="muted">Click one to jump to it.</p>}
        {cited.length > 0 && version && (
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
                      {citationSummary(citation.id, version, nameOf)}
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
