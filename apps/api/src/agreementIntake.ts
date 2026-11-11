import {
  localDocumentReaders,
  readUploadedPdf,
  type DocumentReaders,
} from "./documentReaders.js";
import { randomUUID } from "node:crypto";
import {
  createCollaboration,
  Currency,
  MemberRole,
  updateAgreementDetails,
  validateAgreementDetails,
  type AgreementDetails,
  type AgreementDetailsPatch,
} from "@fairshare/domain";
import { sourceHash, type SourceDocument } from "@fairshare/contract-ai";
import type { FairshareApp } from "./app.js";
import type { AggregateStore } from "./fairshare.js";
import { ApiError, Role } from "./identity.js";
import { decodePdfBase64, extractPdf, MAX_PDF_REQUEST_BYTES } from "./pdf.js";
import {
  decodeDocxBase64,
  extractDocx,
  MAX_DOCX_REQUEST_BYTES,
} from "./docx.js";
import { extractPdfOcr } from "./ocr.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Intake = {
  requestId: string;
  workspaceId?: string;
  text?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  useLocalOcr?: boolean;
  name?: string;
  details?: AgreementDetails;
};

type IntakeReplayRow = {
  fingerprint: string;
  workspace_id: string;
  agreement_id: string;
  document_id: string;
};

type StoredSourceRow = {
  source: string;
  hash: string;
  provenance: string;
};

function invalid(message: string): never {
  throw new ApiError(400, "INVALID_INPUT", message);
}

const DETAIL_FIELDS = ["currency", "effectiveFrom", "effectiveTo"] as const;

/** Same rules as the rename route: 1–200 characters, no control characters. */
function agreementName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    invalid("Name must contain 1–200 characters.");
  return value.trim();
}

/** Picks provided detail fields; returns undefined when none were sent. */
function detailFields(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const present = DETAIL_FIELDS.filter((key) => value[key] !== undefined);
  if (!present.length) return undefined;
  return Object.fromEntries(present.map((key) => [key, value[key]]));
}

function validateInput(raw: unknown): Intake {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    invalid("JSON object required.");
  const value = raw as Record<string, unknown>;
  const allowed = [
    "requestId",
    "workspaceId",
    "text",
    "base64",
    "mimeType",
    "filename",
    "useLocalOcr",
    "name",
    ...DETAIL_FIELDS,
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    invalid("Unknown upload field.");
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId))
    invalid("A UUID requestId is required.");
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== "string" || !UUID.test(value.workspaceId))
  )
    invalid("Invalid workspace.");
  if (
    value.filename !== undefined &&
    (typeof value.filename !== "string" || value.filename.length > 255)
  )
    invalid("Invalid filename.");
  if (value.useLocalOcr !== undefined && typeof value.useLocalOcr !== "boolean")
    invalid("Invalid OCR choice.");
  if (value.text !== undefined && typeof value.text !== "string")
    invalid("Agreement text must be a string.");
  if (value.base64 !== undefined && typeof value.base64 !== "string")
    invalid("File content must be base64 text.");
  const isText = typeof value.text === "string";
  const isFile = typeof value.base64 === "string";
  if (isText === isFile) invalid("Provide either agreement text or one file.");
  if (isText) {
    if (!(value.text as string).trim() || (value.text as string).length > 40000)
      invalid("Agreement text must contain 1–40,000 characters.");
    if (value.mimeType !== undefined || value.useLocalOcr === true)
      invalid("File options require a file.");
  } else if (
    value.mimeType !== "application/pdf" &&
    value.mimeType !== DOCX_MIME
  ) {
    invalid("Upload a PDF or DOCX document.");
  }
  if (value.useLocalOcr === true && value.mimeType !== "application/pdf")
    invalid("OCR is available for PDFs only.");
  const name = value.name === undefined ? undefined : agreementName(value.name);
  const fields = detailFields(value);
  const details = fields
    ? validateAgreementDetails({ currency: Currency.USD, ...fields })
    : undefined;
  for (const key of ["name", ...DETAIL_FIELDS]) delete value[key];
  return {
    ...value,
    requestId: value.requestId.toLowerCase(),
    name,
    details,
  } as Intake;
}

function initialTitle(filename: string | undefined, text: string): string {
  const name = filename
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.(pdf|docx|txt)$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (name) return name.slice(0, 100);
  // A pasted document has no filename. Use only its first nonempty line when it
  // looks like a heading, never generate a title from payment terms or party names.
  // This local fallback does not send the document to an AI provider.
  const heading = text
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  if (
    heading &&
    heading.length <= 100 &&
    heading.split(/\s+/).length <= 12 &&
    /\b(agreement|contract|memorandum)\b/i.test(heading) &&
    !/[\u0000-\u001f\u007f<>@%$€£.!?;:=]/.test(heading) &&
    !/\b(shall|must|will|receives?|pays?|send|ignore|instructions?|approved|signed)\b/i.test(
      heading,
    )
  ) {
    return heading;
  }
  return "Untitled agreement";
}

/** Parsing finishes before durable writes. A user-scoped retry key commits alongside
 * workspace, organizer membership, agreement and immutable source in one transaction. */
export function registerAgreementIntake(
  app: FairshareApp,
  aggregates: AggregateStore,
  options: {
    localOcrEnabled?: boolean;
    documentReaders?: DocumentReaders;
  } = {},
) {
  const readers = options.documentReaders ?? localDocumentReaders;
  const db = app.store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS agreement_intakes(
    user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, workspace_id TEXT NOT NULL, agreement_id TEXT NOT NULL,
    document_id TEXT NOT NULL, PRIMARY KEY(user_id,request_id))`);

  app.post(
    "/api/agreements/intake",
    {
      bodyLimit: Math.max(MAX_PDF_REQUEST_BYTES, MAX_DOCX_REQUEST_BYTES),
    },
    async (request, reply) => {
      const user = app.requireSession(request);
      const input = validateInput(request.body);
      const fingerprinted: unknown[] = [
        input.workspaceId ?? null,
        input.text ?? null,
        input.base64 ?? null,
        input.mimeType ?? null,
        input.filename ?? null,
        input.useLocalOcr === true,
      ];
      // Appended only when sent, so fingerprints of pre-details requests are unchanged.
      if (input.name !== undefined || input.details !== undefined)
        fingerprinted.push({
          name: input.name ?? null,
          details: input.details ?? null,
        });
      const fingerprint = sourceHash(JSON.stringify(fingerprinted));
      const replay = () => {
        const prior = db
          .prepare(
            "SELECT * FROM agreement_intakes WHERE user_id=? AND request_id=?",
          )
          .get(user.id, input.requestId) as IntakeReplayRow | undefined;
        if (!prior) return null;
        if (prior.fingerprint !== fingerprint)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Use a new requestId for a changed upload.",
          );
        const { workspace } = app.requireWorkspace(
          request,
          prior.workspace_id,
          [Role.OWNER, Role.MEMBER],
        );
        const agreement = aggregates.read(
          prior.workspace_id,
          prior.agreement_id,
        );
        if (
          !agreement.value.members.some((member) => member.userId === user.id)
        )
          throw new ApiError(403, "FORBIDDEN", "Agreement access required.");
        const stored = db
          .prepare(
            "SELECT source,hash,provenance FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND id=?",
          )
          .get(
            prior.workspace_id,
            prior.agreement_id,
            prior.document_id,
          ) as StoredSourceRow;
        return {
          workspace,
          agreement,
          document: {
            ...JSON.parse(stored.source),
            sourceHash: stored.hash,
            provenance: JSON.parse(stored.provenance),
          },
        };
      };
      const existing = replay();
      if (existing) return existing;
      if (input.workspaceId)
        app.requireWorkspace(request, input.workspaceId, [
          Role.OWNER,
          Role.MEMBER,
        ]);
      app.store.limit(`intake:${user.id}`, 10);
      let text = input.text!;
      let original: Buffer | null = null;
      let provenance: object = {
        inputType: "TEXT",
        offsetUnit: "UTF16_CODE_UNITS",
      };
      if (input.base64 !== undefined) {
        if (input.mimeType === "application/pdf") {
          if (input.useLocalOcr && !options.localOcrEnabled)
            throw new ApiError(
              400,
              "OCR_UNAVAILABLE",
              "OCR is not enabled. Paste text instead.",
            );
          original = decodePdfBase64(input.base64);
          const parsed = await readUploadedPdf(readers, original, {
            ocrEnabled: !!options.localOcrEnabled,
            forceOcr: input.useLocalOcr === true,
          });
          text = parsed.text;
          provenance = {
            inputType: "PDF",
            sourceFileSha256: parsed.sourceFileSha256,
            pages: parsed.pages,
            ...parsed.extraction,
          };
        } else {
          original = decodeDocxBase64(input.base64);
          const parsed = await readers.docx(original);
          text = parsed.text;
          provenance = {
            inputType: "DOCX",
            sourceFileSha256: parsed.sourceFileSha256,
            ...parsed.extraction,
          };
        }
      }
      if (!text.trim() || text.length > 40000)
        invalid("Document must contain 1–40,000 characters of readable text.");
      // Recheck session and destination after asynchronous parser work and before writes.
      app.requireSession(request);
      return app.store.tx(() => {
        const concurrent = replay();
        if (concurrent) return concurrent;
        const title = input.name ?? initialTitle(input.filename, text);
        const workspace = input.workspaceId
          ? app.requireWorkspace(request, input.workspaceId, [
              Role.OWNER,
              Role.MEMBER,
            ]).workspace
          : app.store.createWorkspaceInsideTransaction(
              user.id,
              title.slice(0, 100),
            );
        const collaboration = createCollaboration(
          {
            id: randomUUID(),
            name: title,
            members: [
              {
                userId: user.id,
                displayName: user.name,
                role: MemberRole.ORGANIZER,
              },
            ],
            ...(input.details ? { details: input.details } : {}),
          },
          user.id,
          new Date().toISOString(),
        );
        db.prepare("INSERT INTO fairshare_collaborations VALUES(?,?,1,?)").run(
          workspace.id,
          collaboration.id,
          JSON.stringify(collaboration),
        );
        const document: SourceDocument = {
          documentId: randomUUID(),
          revision: 1,
          text,
        };
        const hash = sourceHash(text);
        db.prepare(
          `INSERT INTO fairshare_documents(workspace_id,collaboration_id,id,revision,source,hash,provenance,original,original_mime)
        VALUES(?,?,?,?,?,?,?,?,?)`,
        ).run(
          workspace.id,
          collaboration.id,
          document.documentId,
          1,
          JSON.stringify(document),
          hash,
          JSON.stringify(provenance),
          original,
          original ? input.mimeType! : null,
        );
        db.prepare("INSERT INTO agreement_intakes VALUES(?,?,?,?,?,?)").run(
          user.id,
          input.requestId,
          fingerprint,
          workspace.id,
          collaboration.id,
          document.documentId,
        );
        reply.code(201);
        return {
          workspace,
          agreement: aggregates.read(workspace.id, collaboration.id),
          document: { ...document, sourceHash: hash, provenance },
        };
      });
    },
  );

  app.post<{ Params: { workspaceId: string } }>(
    "/api/workspaces/:workspaceId/name",
    async (request) => {
      const { workspaceId } = request.params;
      const { user } = app.requireWorkspace(request, workspaceId, [Role.OWNER]);
      const input = request.body as { name?: unknown };
      if (
        !input ||
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(input.name)
      )
        invalid("Name must contain 1–100 characters.");
      const name = input.name.trim();
      return app.store.tx(() => {
        db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(
          name,
          workspaceId,
        );
        app.store.audit(user.id, workspaceId, "WORKSPACE_RENAMED");
        return { workspace: app.store.membership(user.id, workspaceId) };
      });
    },
  );

  app.post<{ Params: { workspaceId: string; collaborationId: string } }>(
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/name",
    async (request) => {
      const { workspaceId, collaborationId } = request.params;
      const { user } = app.requireWorkspace(request, workspaceId, [
        Role.OWNER,
        Role.MEMBER,
      ]);
      const input = request.body as {
        name?: unknown;
        expectedRevision?: unknown;
      };
      if (
        !input ||
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(input.name)
      )
        invalid("Name must contain 1–200 characters.");
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        Number(input.expectedRevision) < 1
      )
        invalid("expectedRevision required.");
      const name = input.name.trim();
      return aggregates.update(
        workspaceId,
        collaborationId,
        Number(input.expectedRevision),
        (current) => {
          if (
            !current.members.some(
              (member) =>
                member.userId === user.id &&
                member.role === MemberRole.ORGANIZER,
            )
          ) {
            throw new ApiError(403, "FORBIDDEN", "Organizer required.");
          }
          app.store.audit(user.id, workspaceId, "AGREEMENT_RENAMED", {
            agreementId: collaborationId,
          });
          return { ...current, name };
        },
      );
    },
  );

  /** Edits name, currency and effective dates together. Details are metadata only;
   * allocation, payments and payouts stay USD-only. */
  app.post<{ Params: { workspaceId: string; collaborationId: string } }>(
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/details",
    async (request) => {
      const { workspaceId, collaborationId } = request.params;
      const { user } = app.requireWorkspace(request, workspaceId, [
        Role.OWNER,
        Role.MEMBER,
      ]);
      const input = request.body as Record<string, unknown> | undefined;
      if (!input || typeof input !== "object" || Array.isArray(input))
        invalid("JSON object required.");
      if (
        Object.keys(input).some(
          (key) =>
            !["expectedRevision", "name", ...DETAIL_FIELDS].includes(key),
        )
      )
        invalid("Unknown agreement detail.");
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        Number(input.expectedRevision) < 1
      )
        invalid("expectedRevision required.");
      const name =
        input.name === undefined ? undefined : agreementName(input.name);
      const patch = detailFields(input) as AgreementDetailsPatch | undefined;
      if (name === undefined && !patch)
        invalid("Provide a name, currency or effective dates to change.");
      return aggregates.update(
        workspaceId,
        collaborationId,
        Number(input.expectedRevision),
        (current) => {
          if (
            !current.members.some(
              (member) =>
                member.userId === user.id &&
                member.role === MemberRole.ORGANIZER,
            )
          ) {
            throw new ApiError(403, "FORBIDDEN", "Organizer required.");
          }
          const next = patch
            ? updateAgreementDetails(current, patch, user.id)
            : current;
          app.store.audit(user.id, workspaceId, "AGREEMENT_DETAILS_UPDATED", {
            agreementId: collaborationId,
            fields: [
              ...(name === undefined ? [] : ["name"]),
              ...Object.keys(patch ?? {}),
            ],
          });
          return name === undefined ? next : { ...next, name };
        },
      );
    },
  );
}
