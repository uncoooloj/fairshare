import {
  localDocumentReaders,
  type DocumentReaders,
} from "./documentReaders.js";
import { extractPdfOcr } from "./ocr.js";
import {
  decodeDocxBase64,
  extractDocx,
  MAX_DOCX_REQUEST_BYTES,
} from "./docx.js";
import { decodePdfBase64, extractPdf, MAX_PDF_REQUEST_BYTES } from "./pdf.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createCollaboration,
  proposeVersion,
  sendForReview,
  approveVersion,
  activateVersion,
  requestChange,
  previewVersion,
  DomainError,
  MemberRole,
  type Collaboration,
  type Rules,
} from "@fairshare/domain";
import {
  extractContract,
  sourceHash,
  type CloudflareConfig,
  type SourceDocument,
  type ExtractionResult,
} from "@fairshare/contract-ai";
import type { Database } from "./database.js";
import { Role } from "./identity.js";
export interface FairshareApp extends FastifyInstance {
  store: {
    db: Database;
    tx<T>(fn: () => T): T;
    limit(key: string, max: number): void;
  };
  requireSession(req: FastifyRequest): {
    id: string;
    email: string;
    name: string;
  };
  requireWorkspace(
    req: FastifyRequest,
    id: string,
    roles?: any[],
  ): { user: { id: string; email: string; name: string }; workspace: unknown };
}
export interface AggregateRow {
  workspaceId: string;
  id: string;
  revision: number;
  value: Collaboration;
}
export class AggregateStore {
  constructor(
    readonly db: Database,
    readonly tx: <T>(fn: () => T) => T,
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS fairshare_collaborations(workspace_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(workspace_id,id)); CREATE TABLE IF NOT EXISTS fairshare_documents(workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,source TEXT NOT NULL,hash TEXT NOT NULL,extraction TEXT,PRIMARY KEY(workspace_id,collaboration_id,id)); CREATE TABLE IF NOT EXISTS fairshare_captures(provider_capture_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL);`,
    );
  }
  read(workspaceId: string, id: string): AggregateRow {
    const r = this.db
      .prepare(
        "SELECT * FROM fairshare_collaborations WHERE workspace_id=? AND id=?",
      )
      .get(workspaceId, id) as any;
    if (!r) throw new DomainError("NOT_FOUND", "Collaboration not found");
    return {
      workspaceId,
      id,
      revision: Number(r.revision),
      value: JSON.parse(r.value),
    };
  }
  list(workspaceId: string, userId: string): AggregateRow[] {
    return (
      this.db
        .prepare("SELECT id FROM fairshare_collaborations WHERE workspace_id=?")
        .all(workspaceId) as any[]
    )
      .map((r) => this.read(workspaceId, r.id))
      .filter((r) => r.value.members.some((m) => m.userId === userId));
  }
  insert(workspaceId: string, value: Collaboration): AggregateRow {
    return this.tx(() => {
      this.db
        .prepare("INSERT INTO fairshare_collaborations VALUES(?,?,1,?)")
        .run(workspaceId, value.id, JSON.stringify(value));
      return this.read(workspaceId, value.id);
    });
  }
  update(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    transition: (c: Collaboration) => Collaboration,
  ): AggregateRow {
    return this.tx(() =>
      this.updateInsideTransaction(
        workspaceId,
        id,
        expectedRevision,
        transition,
      ),
    );
  }
  updateInsideTransaction(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    transition: (c: Collaboration) => Collaboration,
  ): AggregateRow {
    const old = this.read(workspaceId, id);
    if (old.revision !== expectedRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "Reload the latest state before changing it",
      );
    const next = transition(old.value);
    this.db
      .prepare(
        "UPDATE fairshare_collaborations SET revision=revision+1,value=? WHERE workspace_id=? AND id=?",
      )
      .run(JSON.stringify(next), workspaceId, id);
    return this.read(workspaceId, id);
  }
}
const required = (v: unknown, label: string, max = 200): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new DomainError("INVALID_INPUT", `${label} required`);
  return v;
};
const body = (req: FastifyRequest): Record<string, any> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new DomainError("INVALID_INPUT", "JSON object required");
  return req.body as Record<string, any>;
};
const revision = (b: Record<string, any>) => {
  if (!Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
    throw new DomainError("INVALID_INPUT", "expectedRevision required");
  return b.expectedRevision as number;
};
const params = (req: FastifyRequest) =>
  req.params as {
    workspaceId: string;
    collaborationId: string;
    documentId: string;
  };
const membership = (c: Collaboration, id: string) => {
  if (!c.members.some((m) => m.userId === id))
    throw new DomainError("FORBIDDEN", "Not a collaboration member");
};
export function registerFairshareRoutes(
  app: FairshareApp,
  options: {
    ai?: CloudflareConfig;
    extract?: typeof extractContract;
    localOcrEnabled?: boolean;
    documentReaders?: DocumentReaders;
  } = {},
) {
  const readers = options.documentReaders ?? localDocumentReaders;
  const store = new AggregateStore(app.store.db, (fn) => app.store.tx(fn));
  if (
    !(
      app.store.db
        .prepare("PRAGMA table_info(fairshare_documents)")
        .all() as any[]
    ).some((c) => c.name === "provenance")
  )
    app.store.db.exec(
      "ALTER TABLE fairshare_documents ADD COLUMN provenance TEXT",
    );
  for (const [name, type] of [
    ["original", "BLOB"],
    ["original_mime", "TEXT"],
  ])
    if (
      !(
        app.store.db
          .prepare("PRAGMA table_info(fairshare_documents)")
          .all() as any[]
      ).some((c) => c.name === name)
    )
      app.store.db.exec(
        `ALTER TABLE fairshare_documents ADD COLUMN ${name} ${type}`,
      );
  const base = "/api/workspaces/:workspaceId/collaborations";
  function access(req: FastifyRequest) {
    const p = params(req);
    const { user } = app.requireWorkspace(
      req,
      p.workspaceId,
      req.method === "GET" ? undefined : [Role.OWNER, Role.MEMBER],
    );
    const row = store.read(p.workspaceId, p.collaborationId);
    membership(row.value, user.id);
    return { p, user, row };
  }
  app.get(base, async (req) => {
    const p = params(req);
    const { user } = app.requireWorkspace(req, p.workspaceId);
    return { collaborations: store.list(p.workspaceId, user.id) };
  });
  app.post(base, async (req, reply) => {
    const p = params(req);
    const { user } = app.requireWorkspace(req, p.workspaceId, [
      Role.OWNER,
      Role.MEMBER,
    ]);
    const b = body(req);
    const c = createCollaboration(
      {
        id: randomUUID(),
        name: required(b.name, "Name"),
        members: [
          {
            userId: user.id,
            displayName: user.name,
            role: MemberRole.ORGANIZER,
          },
        ],
      },
      user.id,
      new Date().toISOString(),
    );
    reply.code(201);
    return store.insert(p.workspaceId, c);
  });
  app.get(`${base}/:collaborationId`, async (req) => access(req).row);
  // Members must already be authenticated workspace members; invitation acceptance happens in identity API.
  app.post(`${base}/:collaborationId/members`, async (req) => {
    const { p, user } = access(req);
    const b = body(req);
    const userId = required(b.userId, "User ID");
    return store.update(p.workspaceId, p.collaborationId, revision(b), (c) => {
      if (
        c.members.find((m) => m.userId === user.id)?.role !==
        MemberRole.ORGANIZER
      )
        throw new DomainError("FORBIDDEN", "Organizer required");
      if (c.versions.length)
        throw new DomainError(
          "MEMBERS_LOCKED",
          "Add collaborators before drafting rules",
        );
      if (c.members.some((m) => m.userId === userId)) return c;
      // Schema-independent identity authorization: pass an authenticated synthetic request is NOT allowed.
      // Host supplies explicit lookup below rather than trusting supplied membership claims.
      const target = app.store.db
        .prepare(
          "SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.role IN (?,?)",
        )
        .get(p.workspaceId, userId, Role.OWNER, Role.MEMBER) as any;
      if (!target)
        throw new DomainError(
          "NOT_WORKSPACE_MEMBER",
          "Recipient must accept the workspace invitation first",
        );
      const next = structuredClone(c);
      next.members.push({
        userId,
        displayName: target.name,
        role: MemberRole.COLLABORATOR,
      });
      return next;
    });
  });
  app.post(`${base}/:collaborationId/versions`, async (req) => {
    const { p, user } = access(req);
    const b = body(req);
    return store.update(p.workspaceId, p.collaborationId, revision(b), (c) => {
      const r = b.rules as Rules;
      if (!r || typeof r !== "object")
        throw new DomainError("INVALID_RULES", "Rules required");
      const refs = [r.source, ...(r.advance ? [r.advance.source] : [])];
      for (const ref of refs) {
        if (!ref) throw new DomainError("INVALID_SOURCE", "Source required");
        const doc = app.store.db
          .prepare(
            "SELECT source FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND id=?",
          )
          .get(p.workspaceId, p.collaborationId, ref.documentId) as any;
        if (!doc)
          throw new DomainError(
            "INVALID_SOURCE",
            "Source document must belong to this collaboration",
          );
        if (
          ref.origin === "SOURCE_CLAUSE" &&
          !JSON.parse(doc.source).text.includes(ref.excerpt)
        )
          throw new DomainError(
            "INVALID_SOURCE",
            "Source excerpt does not occur in document",
          );
      }
      return proposeVersion(c, r, user.id, new Date().toISOString());
    });
  });
  for (const [action, transition] of Object.entries({
    send: sendForReview,
    approve: approveVersion,
    activate: activateVersion,
  })) {
    app.post(
      `${base}/:collaborationId/versions/:versionId/${action}`,
      async (req) => {
        const { p, user } = access(req);
        const b = body(req);
        const id = Number((req.params as any).versionId);
        return store.update(
          p.workspaceId,
          p.collaborationId,
          revision(b),
          (c) => transition(c, id, user.id, new Date().toISOString()),
        );
      },
    );
  }
  app.post(
    `${base}/:collaborationId/versions/:versionId/request-change`,
    async (req) => {
      const { p, user } = access(req);
      const b = body(req);
      return store.update(p.workspaceId, p.collaborationId, revision(b), (c) =>
        requestChange(
          c,
          Number((req.params as any).versionId),
          required(b.reason, "Reason", 2000),
          user.id,
          new Date().toISOString(),
        ),
      );
    },
  );
  app.post(
    `${base}/:collaborationId/versions/:versionId/preview`,
    async (req) => {
      const { user, row } = access(req);
      const b = body(req);
      return previewVersion(
        row.value,
        Number((req.params as any).versionId),
        { grossCents: b.grossCents, feeCents: b.feeCents },
        user.id,
      );
    },
  );
  app.post(`${base}/:collaborationId/documents`, async (req, reply) => {
    const { p } = access(req);
    const b = body(req);
    const text = required(b.text, "Agreement text", 40000);
    const doc: SourceDocument = { documentId: randomUUID(), revision: 1, text };
    app.store.db
      .prepare(
        "INSERT INTO fairshare_documents(workspace_id,collaboration_id,id,revision,source,hash) VALUES(?,?,?,?,?,?)",
      )
      .run(
        p.workspaceId,
        p.collaborationId,
        doc.documentId,
        1,
        JSON.stringify(doc),
        sourceHash(text),
      );
    reply.code(201);
    return {
      documentId: doc.documentId,
      revision: 1,
      sourceHash: sourceHash(text),
    };
  });
  app.get(`${base}/:collaborationId/documents/capabilities`, async (req) => {
    access(req);
    return {
      localOcrEnabled: !!options.localOcrEnabled,
      ocrMaxPages: 5,
      ocrLanguage: "eng",
      processingLocation: readers.processingLocation ?? "SERVER",
      externalUpload: readers.processingLocation === "CLOUDFLARE_CONTAINER",
    };
  });
  app.post(
    `${base}/:collaborationId/documents/pdf`,
    { bodyLimit: MAX_PDF_REQUEST_BYTES },
    async (req, reply) => {
      const { p, user } = access(req);
      app.store.limit(`pdf:${user.id}`, 5);
      const b = body(req);
      if (b.mimeType !== "application/pdf")
        throw new DomainError("INVALID_PDF", "Upload a PDF document.");
      const bytes = decodePdfBase64(b.base64);
      if (b.useLocalOcr === true && !options.localOcrEnabled)
        throw new DomainError(
          "OCR_UNAVAILABLE",
          "OCR is not enabled. Paste text or ask the server operator to enable it.",
        );
      const parsed =
        b.useLocalOcr === true
          ? await readers.ocr(bytes)
          : await readers.pdf(bytes);
      // Recheck membership after asynchronous parsing; revoked sessions/members must not persist documents.
      access(req);
      const documentId = randomUUID();
      const doc: SourceDocument = {
        documentId,
        revision: 1,
        text: parsed.text,
      };
      const provenance = {
        inputType: "PDF",
        sourceFileSha256: parsed.sourceFileSha256,
        pages: parsed.pages,
        ...parsed.extraction,
      };
      app.store.db
        .prepare(
          "INSERT INTO fairshare_documents(workspace_id,collaboration_id,id,revision,source,hash,provenance,original,original_mime) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          p.workspaceId,
          p.collaborationId,
          documentId,
          1,
          JSON.stringify(doc),
          sourceHash(doc.text),
          JSON.stringify(provenance),
          bytes,
          "application/pdf",
        );
      reply.code(201);
      return {
        documentId,
        revision: 1,
        sourceHash: sourceHash(doc.text),
        provenance,
        notice:
          "Review the extracted text before asking AI to interpret it. PDF reading order may differ from the visual layout.",
      };
    },
  );
  // Metadata only; full confidential text stays behind the individual document endpoint.
  app.post(
    `${base}/:collaborationId/documents/docx`,
    { bodyLimit: MAX_DOCX_REQUEST_BYTES },
    async (req, reply) => {
      const { p, user } = access(req);
      app.store.limit(`docx:${user.id}`, 5);
      const b = body(req);
      const mime =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (b.mimeType !== mime)
        throw new DomainError("INVALID_DOCX", "Upload a DOCX document.");
      const bytes = decodeDocxBase64(b.base64);
      const parsed = await readers.docx(bytes);
      access(req);
      const documentId = randomUUID();
      const doc: SourceDocument = {
        documentId,
        revision: 1,
        text: parsed.text,
      };
      const provenance = {
        inputType: "DOCX",
        sourceFileSha256: parsed.sourceFileSha256,
        ...parsed.extraction,
      };
      app.store.db
        .prepare(
          "INSERT INTO fairshare_documents(workspace_id,collaboration_id,id,revision,source,hash,provenance,original,original_mime) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          p.workspaceId,
          p.collaborationId,
          documentId,
          1,
          JSON.stringify(doc),
          sourceHash(doc.text),
          JSON.stringify(provenance),
          bytes,
          mime,
        );
      reply.code(201);
      return {
        documentId,
        revision: 1,
        sourceHash: sourceHash(doc.text),
        provenance,
        notice:
          "Review extracted text against the original. Formatting, tracked edits and document layout are not preserved. No automatic AI processing occurred.",
      };
    },
  );
  app.get(
    `${base}/:collaborationId/documents/:documentId/original`,
    async (req, reply) => {
      const { p } = access(req);
      const row = app.store.db
        .prepare(
          "SELECT original,original_mime FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND id=?",
        )
        .get(p.workspaceId, p.collaborationId, p.documentId) as any;
      if (!row?.original)
        throw new DomainError(
          "NOT_FOUND",
          "Original file unavailable for this document. Older uploads retain extracted text only.",
        );
      const extension =
        row.original_mime === "application/pdf" ? "pdf" : "docx";
      return reply
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header(
          "Content-Disposition",
          `attachment; filename="fairshare-original.${extension}"`,
        )
        .type(row.original_mime)
        .send(Buffer.from(row.original));
    },
  );
  app.get(`${base}/:collaborationId/documents`, async (req) => {
    const { p } = access(req);
    const query = req.query as Record<string, unknown>;
    const cursor = query.before;
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" ||
        !/^\d{1,15}$/.test(cursor) ||
        !Number.isSafeInteger(Number(cursor)) ||
        Number(cursor) < 1)
    )
      throw new DomainError("INVALID_INPUT", "Invalid document cursor");
    const rows = app.store.db
      .prepare(
        "SELECT rowid AS sequence,id,revision,hash,extraction IS NOT NULL AS has_extraction,provenance FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND rowid<? ORDER BY rowid DESC LIMIT 101",
      )
      .all(
        p.workspaceId,
        p.collaborationId,
        cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor),
      ) as any[];
    const page = rows.slice(0, 100);
    return {
      documents: page.map((row) => ({
        documentId: row.id,
        revision: row.revision,
        sourceHash: row.hash,
        hasExtraction: !!row.has_extraction,
        provenance: row.provenance
          ? JSON.parse(row.provenance)
          : { inputType: "TEXT", offsetUnit: "UTF16_CODE_UNITS" },
      })),
      nextCursor:
        rows.length > 100 ? String(page[page.length - 1].sequence) : null,
    };
  });
  app.get(`${base}/:collaborationId/documents/:documentId`, async (req) => {
    const { p } = access(req);
    const row = app.store.db
      .prepare(
        "SELECT source,hash,extraction,provenance,original IS NOT NULL AS has_original FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND id=?",
      )
      .get(p.workspaceId, p.collaborationId, p.documentId) as any;
    if (!row) throw new DomainError("NOT_FOUND", "Document not found");
    return {
      ...JSON.parse(row.source),
      hasOriginal: !!row.has_original,
      sourceHash: row.hash,
      extraction: row.extraction ? JSON.parse(row.extraction) : null,
      provenance: row.provenance
        ? JSON.parse(row.provenance)
        : { inputType: "TEXT", offsetUnit: "UTF16_CODE_UNITS" },
    };
  });
  app.post(
    `${base}/:collaborationId/documents/:documentId/extract`,
    async (req) => {
      const { p, user } = access(req);
      app.store.limit(`ai:${user.id}`, 10);
      const b = body(req);
      if (b.consentToCloudflare !== true)
        throw new DomainError(
          "CONSENT_REQUIRED",
          "Confirm processing this agreement with Cloudflare",
        );
      const row = app.store.db
        .prepare(
          "SELECT source,hash FROM fairshare_documents WHERE workspace_id=? AND collaboration_id=? AND id=?",
        )
        .get(p.workspaceId, p.collaborationId, p.documentId) as any;
      if (!row) throw new DomainError("NOT_FOUND", "Document not found");
      const document = JSON.parse(row.source) as SourceDocument;
      const result: ExtractionResult = await (
        options.extract ?? extractContract
      )(document, options.ai);
      // Revalidate session and membership after provider I/O before returning or persisting confidential output.
      access(req);
      // Source docs immutable; conditional write still protects source binding and asynchronous races.
      if (
        result.sourceHash !== row.hash ||
        result.documentId !== document.documentId ||
        result.revision !== document.revision
      )
        throw new DomainError(
          "STALE_EXTRACTION",
          "Source changed while extracting",
        );
      app.store.db
        .prepare(
          "UPDATE fairshare_documents SET extraction=? WHERE workspace_id=? AND collaboration_id=? AND id=? AND hash=?",
        )
        .run(
          JSON.stringify(result),
          p.workspaceId,
          p.collaborationId,
          p.documentId,
          row.hash,
        );
      return result;
    },
  );
  return { store, access };
}
