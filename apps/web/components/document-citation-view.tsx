"use client";
import { useEffect, useMemo, useState } from "react";
import type { Version } from "../lib/model";
import {
  documentCitations,
  OPEN_CITATION_EVENT,
} from "../lib/document-citations";
import { HighlightedSource } from "./source-rule-context";

export function DocumentCitationView({
  version,
  document,
}: {
  version?: Version;
  document: {
    documentId: string;
    text: string;
    provenance?: {
      pages?: number | { page: number; start: number; end: number }[];
    };
  };
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const citations = useMemo(
    () => documentCitations(version, document),
    [version, document],
  );
  const highlights = citations.flatMap((citation) =>
    citation.highlight ? [citation.highlight] : [],
  );
  useEffect(() => setSelected(null), [document.documentId, version?.id]);
  // A rule's clause chip asks for its quote: highlight it when it can be found.
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (
        !citations.some((citation) => citation.id === id && citation.highlight)
      )
        return;
      event.preventDefault();
      setSelected(null);
      requestAnimationFrame(() => setSelected(id));
    };
    window.addEventListener(OPEN_CITATION_EVENT, open);
    return () => window.removeEventListener(OPEN_CITATION_EVENT, open);
  }, [citations]);
  const chosen = citations.find((citation) => citation.id === selected);
  return (
    <div className="document-layout">
      <article className="panel source-paper" aria-label="Agreement text">
        <HighlightedSource
          source={document.text}
          highlights={highlights}
          selected={selected}
          onSelect={setSelected}
        />
      </article>
      <aside className="panel" aria-label="Where the split comes from">
        <h3>Where the split comes from</h3>
        <p className="muted">Tap one to find it in the text.</p>
        {citations.length ? (
          citations.map((citation) => (
            <div className="section" key={citation.id}>
              <button
                type="button"
                className="text-button"
                disabled={!citation.highlight}
                aria-pressed={selected === citation.id}
                onClick={() => setSelected(citation.id)}
              >
                {citation.reference.clause || citation.label} · {citation.label}
                {citation.page !== undefined && ` · Page ${citation.page}`}
              </button>
              <blockquote>
                {citation.reference.excerpt || "No saved quote"}
              </blockquote>
              {citation.unavailable && (
                <p className="muted">{citation.unavailable}</p>
              )}
            </div>
          ))
        ) : (
          <p className="muted">These appear once you propose a split.</p>
        )}
        <p className="sr-only" role="status">
          {chosen ? `Showing ${chosen.reference.clause || chosen.label}` : ""}
        </p>
      </aside>
    </div>
  );
}
