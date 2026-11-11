"use client";
import { useEffect, useMemo, useState } from "react";
import type { Version } from "../lib/model";
import { documentCitations } from "../lib/document-citations";
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
      <aside className="panel" aria-label="Cited clauses">
        <h3>Cited clauses</h3>
        <p className="muted">Choose a clause to find it in the agreement.</p>
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
          <p className="muted">
            Cited clauses will appear after you propose the rules.
          </p>
        )}
        <p className="sr-only" role="status">
          {chosen ? `Showing ${chosen.reference.clause || chosen.label}` : ""}
        </p>
      </aside>
    </div>
  );
}
