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
}: {
  agreement: Agreement;
  base: string;
}) {
  const initial =
    agreement.value.activeVersionId ?? agreement.value.versions.at(-1)?.id;
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
    <section aria-label="Your agreement">
      <div className="document-toolbar">
        <div>
          <h2>Your agreement</h2>
          <p className="muted">The text the split comes from.</p>
        </div>
        <div className="actions document-actions">
          {agreement.value.versions.length > 0 && (
            <label className="document-version">
              Version
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
            Download text
          </Button>
        </div>
      </div>
      <p className="document-disclaimer">
        This is the text we read from your file. Check it against the original.
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
          Add your agreement in Terms and it’ll show here.
        </Empty>
      ) : (
        <>
          <p className="muted">
            {document.provenance?.ocr
              ? "Scanned. Check against the original."
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
            aria-label="File details"
          >
            <h3>File details</h3>
            <dl>
              <dt>Used by</dt>
              <dd>{version ? `Version ${version.id}` : "Latest draft"}</dd>
              <dt>Document ID</dt>
              <dd>
                <code>{document.documentId}</code>
              </dd>
              {document.sourceHash && (
                <>
                  <dt>Fingerprint</dt>
                  <dd>
                    <code>{document.sourceHash}</code>
                  </dd>
                </>
              )}
            </dl>
            <small>
              Text from PDFs can come out in a different order. Check the
              wording.
            </small>
          </section>
        </>
      )}
    </section>
  );
}
