"use client";
import { useEffect, useState } from "react";
import { api, type Agreement } from "../lib/model";
import { recoverSourceDocument } from "../lib/source-recovery";
import { DocumentCitationView } from "./document-citation-view";
import { Button, Empty } from "./ui";
interface DocumentRecord {
  hasOriginal?: boolean;
  documentId: string;
  text: string;
  sourceHash?: string;
  provenance?: {
    inputType?: string;
    ocr?: boolean;
    pages?: number | Array<{ page: number; start: number; end: number }>;
  };
}
export function AgreementDocument({
  agreement,
  base,
  reviewedVersionId,
}: {
  agreement: Agreement;
  base: string;
  /** The version being reviewed in Terms, which is not always the active one. */
  reviewedVersionId?: number;
}) {
  const initial =
    reviewedVersionId ??
    agreement.value.activeVersionId ??
    agreement.value.versions.at(-1)?.id;
  const [versionId, setVersionId] = useState<number | undefined>(initial);
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const version = agreement.value.versions.find(
    (item) => item.id === versionId,
  );
  const sourceId = version?.rules.source.documentId;
  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError("");
    setDocument(null);
    recoverSourceDocument(base, sourceId, api)
      .then((result) => {
        if (!stale) setDocument(result);
      })
      .catch((cause) => {
        if (!stale)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load source document.",
          );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [base, sourceId, attempt]);
  function downloadText() {
    if (!document) return;
    const url = URL.createObjectURL(
      new Blob([document.text], { type: "text/plain;charset=utf-8" }),
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `fairshare-source-${versionId ? `v${versionId}` : "draft"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section aria-label="Source document">
      <div className="document-toolbar">
        <div>
          <h2>Source document</h2>
          <p className="muted">
            Review the exact text behind the proposed rules.
          </p>
        </div>
        <div className="actions document-actions">
          {agreement.value.versions.length > 0 && (
            <label className="document-version">
              Source for version
              <select
                aria-label="Document version"
                value={versionId ?? ""}
                onChange={(event) => setVersionId(Number(event.target.value))}
              >
                {agreement.value.versions.map((item) => (
                  <option key={item.id} value={item.id}>
                    Version {item.id}
                    {item.id === agreement.value.activeVersionId
                      ? " · Active"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!loading && document?.hasOriginal && (
            <a
              className="button secondary"
              href={`/api/service/${base}/documents/${encodeURIComponent(document.documentId)}/original`}
            >
              Download original
            </a>
          )}
          <Button
            variant="secondary"
            onClick={downloadText}
            disabled={loading || !document}
          >
            Download extracted text
          </Button>
        </div>
      </div>
      <p className="document-disclaimer">
        This view shows extracted text, not a signature verification. Original
        downloads are available for new PDF and DOCX uploads. Each version keeps
        the document it was created from.
      </p>
      {loading ? (
        <div className="panel" role="status">
          Loading source…
        </div>
      ) : error ? (
        <div className="panel" role="alert">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : !document ? (
        <Empty title="No source document yet">
          Add a PDF, DOCX or text source in Terms. Saved source text will appear
          here.
        </Empty>
      ) : (
        <>
          <p className="muted">
            {document.provenance?.ocr
              ? "Scanned document · check against the original"
              : "Saved agreement text"}
            {document.provenance?.pages && (
              <>
                {" "}
                ·{" "}
                {Array.isArray(document.provenance.pages)
                  ? document.provenance.pages.length
                  : document.provenance.pages}{" "}
                pages read
              </>
            )}
          </p>
          <DocumentCitationView
            key={`${document.documentId}:${version?.id ?? "draft"}`}
            document={document}
            version={version}
          />
          <section
            className="panel document-provenance"
            aria-label="Source details"
          >
            <h3>Source details</h3>
            <dl>
              <dt>Used by</dt>
              <dd>
                {version
                  ? `Version ${version.id}`
                  : "Latest saved draft source"}
              </dd>
              <dt>Document ID</dt>
              <dd>
                <code>{document.documentId}</code>
              </dd>
              {document.sourceHash && (
                <>
                  <dt>Source hash</dt>
                  <dd>
                    <code>{document.sourceHash}</code>
                  </dd>
                </>
              )}
            </dl>
            <small>
              PDF text reading order can differ from its visual layout. Compare
              the wording before approving rules.
            </small>
          </section>
        </>
      )}
    </section>
  );
}
