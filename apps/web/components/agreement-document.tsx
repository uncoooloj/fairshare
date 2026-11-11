"use client";
import { useEffect, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import { recoverSourceDocument } from "../lib/source-recovery";
import {
  OPEN_CITATION_EVENT,
  type OpenCitationDetail,
} from "../lib/document-citations";
import { DocumentCitationView } from "./document-citation-view";
import { Button, Empty } from "./ui";
import { termsLabel } from "../lib/version-summary";
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
function sourceDocumentIds(version: Version) {
  return [
    version.rules.source.documentId,
    version.rules.advance?.source.documentId,
  ].filter((documentId): documentId is string => Boolean(documentId));
}
export function resolveCitationTarget(
  versions: Version[],
  request: OpenCitationDetail,
  currentVersionId?: number,
) {
  const versionId = request.versionId ?? currentVersionId;
  const version = versions.find((item) => item.id === versionId);
  if (!version) return undefined;
  if (
    request.documentId !== undefined &&
    !sourceDocumentIds(version).includes(request.documentId)
  )
    return undefined;
  return { versionId: version.id, documentId: request.documentId };
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
  const [requestedDocumentId, setRequestedDocumentId] = useState<string>();
  const [pendingCitation, setPendingCitation] = useState<OpenCitationDetail>();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const version = agreement.value.versions.find(
    (item) => item.id === versionId,
  );
  const sourceId = requestedDocumentId ?? version?.rules.source.documentId;
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<string | OpenCitationDetail>).detail;
      if (typeof detail === "string" || !detail) return;
      const target = resolveCitationTarget(
        agreement.value.versions,
        detail,
        versionId,
      );
      if (!target) return;
      event.preventDefault();
      setPendingCitation(detail);
      setVersionId(target.versionId);
      setRequestedDocumentId(target.documentId);
    };
    window.addEventListener(OPEN_CITATION_EVENT, open);
    return () => window.removeEventListener(OPEN_CITATION_EVENT, open);
  }, [agreement.value.versions, versionId]);
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
          {agreement.value.versions.length > 1 && (
            <label className="document-version">
              Document for
              <select
                aria-label="Document for which terms"
                value={versionId ?? ""}
                onChange={(event) => {
                  setPendingCitation(undefined);
                  setRequestedDocumentId(undefined);
                  setVersionId(Number(event.target.value));
                }}
              >
                {agreement.value.versions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {termsLabel(item.id)}
                    {item.id === agreement.value.activeVersionId
                      ? " · in use"
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
        Each update keeps the document it was made from.
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
            pendingCitation={pendingCitation}
          />
          <section
            className="panel document-provenance"
            aria-label="File details"
          >
            <h3>File details</h3>
            <dl>
              <dt>Used by</dt>
              <dd>{version ? termsLabel(version.id) : "Latest draft"}</dd>
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
