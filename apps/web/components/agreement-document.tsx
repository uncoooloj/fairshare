"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import { recoverSourceDocument } from "../lib/source-recovery";
import {
  OPEN_CITATION_EVENT,
  type OpenCitationDetail,
} from "../lib/document-citations";
import { DocumentCitationView } from "./document-citation-view";
import { Button, Empty } from "./ui";
import { termsLabel } from "../lib/version-summary";
export interface DocumentRecord {
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
/** The document on screen and the terms it belongs to. */
export interface LoadedDocument {
  document: DocumentRecord;
  versionId?: number;
}

/** We keep no file name: name it after the agreement and how it came in. */
export function documentFileName(agreement: Agreement, record: DocumentRecord) {
  const type = record.provenance?.inputType;
  if (type === "PDF") return `${agreement.value.name}.pdf`;
  if (type === "DOCX") return `${agreement.value.name}.docx`;
  return `${agreement.value.name} (pasted text)`;
}

export function originalDocumentUrl(base: string, record: DocumentRecord) {
  return record.hasOriginal
    ? `/api/service/${base}/documents/${encodeURIComponent(record.documentId)}/original`
    : undefined;
}

export function downloadDocumentText({ document, versionId }: LoadedDocument) {
  const url = URL.createObjectURL(
    new Blob([document.text], { type: "text/plain;charset=utf-8" }),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `fairshare-source-${versionId ? `v${versionId}` : "draft"}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** IDs and fingerprint, out of the way behind a disclosure. */
export function DocumentFileDetails({
  agreement,
  loaded: { document, versionId },
}: {
  agreement: Agreement;
  loaded: LoadedDocument;
}) {
  const pages = document.provenance?.pages;
  const version = agreement.value.versions.find((v) => v.id === versionId);
  return (
    <details className="panel dv-file-details">
      <summary>File details</summary>
      <dl>
        <dt>Used by</dt>
        <dd>{version ? termsLabel(version.id) : "Latest draft"}</dd>
        {pages && (
          <>
            <dt>Pages read</dt>
            <dd>{Array.isArray(pages) ? pages.length : pages}</dd>
          </>
        )}
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
        {document.provenance?.ocr
          ? "Scanned. Check against the original."
          : "Text from PDFs can come out in a different order. Check the wording."}
      </small>
    </details>
  );
}

export function AgreementDocument({
  agreement,
  base,
  reviewedVersionId,
  onDocument,
  requestedCitation,
  onRequestedCitationHandled,
}: {
  agreement: Agreement;
  base: string;
  /** The version being reviewed in Terms, which is not always the active one. */
  reviewedVersionId?: number;
  /** The page shows downloads in its menu and file details below the rules.
   * Without it, both stay here. */
  onDocument?: (loaded: LoadedDocument | null) => void;
  /** A clause picked before this document mounted, such as from Overview. */
  requestedCitation?: OpenCitationDetail;
  onRequestedCitationHandled?: () => void;
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
  const openCitation = useCallback(
    (detail: OpenCitationDetail) => {
      const target = resolveCitationTarget(
        agreement.value.versions,
        detail,
        versionId,
      );
      if (!target) return false;
      setPendingCitation(detail);
      setVersionId(target.versionId);
      setRequestedDocumentId(target.documentId);
      return true;
    },
    [agreement.value.versions, versionId],
  );
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<string | OpenCitationDetail>).detail;
      if (typeof detail === "string" || !detail) return;
      if (openCitation(detail)) event.preventDefault();
    };
    window.addEventListener(OPEN_CITATION_EVENT, open);
    return () => window.removeEventListener(OPEN_CITATION_EVENT, open);
  }, [openCitation]);
  useEffect(() => {
    if (requestedCitation && openCitation(requestedCitation))
      onRequestedCitationHandled?.();
  }, [onRequestedCitationHandled, openCitation, requestedCitation]);
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
  useEffect(() => {
    onDocument?.(document ? { document, versionId } : null);
  }, [document, versionId, onDocument]);
  useEffect(() => () => onDocument?.(null), [onDocument]);
  const nameOf = (userId: string) =>
    agreement.value.members.find((m) => m.userId === userId)?.displayName ||
    "Former participant";
  return (
    <section aria-label="Your agreement">
      {agreement.value.versions.length > 1 && (
        <label className="document-version dv-version">
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
                {item.id === agreement.value.activeVersionId ? " · in use" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading ? (
        <div className="panel" role="status">
          Loading your agreement…
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
          <DocumentCitationView
            key={`${document.documentId}:${version?.id ?? "draft"}`}
            document={document}
            version={version}
            pendingCitation={pendingCitation}
            fileName={documentFileName(agreement, document)}
            nameOf={nameOf}
            originalUrl={originalDocumentUrl(base, document)}
          />
          {!onDocument && (
            <>
              <div className="actions dv-downloads">
                {originalDocumentUrl(base, document) && (
                  <a
                    className="button secondary"
                    href={originalDocumentUrl(base, document)}
                  >
                    Download original
                  </a>
                )}
                <Button
                  variant="secondary"
                  onClick={() => downloadDocumentText({ document, versionId })}
                >
                  Download text
                </Button>
              </div>
              <DocumentFileDetails
                agreement={agreement}
                loaded={{ document, versionId }}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
