import { createServer, type IncomingMessage } from "node:http";
import { DomainError } from "@fairshare/domain";
import { localDocumentReaders } from "../src/documentReaders.js";
import { verifyLocalOcrTools } from "../src/ocr.js";

const MAX_BYTES = 5 * 1024 * 1024;
const parserKinds = ["pdf", "docx", "ocr"] as const;
type ParserKind = (typeof parserKinds)[number];

function isParserKind(kind: string | undefined): kind is ParserKind {
  return parserKinds.includes(kind as ParserKind);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BYTES)
      throw new DomainError("DOCUMENT_TOO_LARGE", "Document too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** No public ingress: expose only through the Cloudflare Container binding. */
export function createParserServer(readers = localDocumentReaders) {
  let active = false;
  return createServer(
    { requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 8192 },
    async (request, response) => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(body));
      };
      const kind = request.url?.slice(1);
      if (request.method !== "POST" || !isParserKind(kind))
        return send(404, { error: "NOT_FOUND" });
      if (request.headers["content-type"] !== "application/octet-stream")
        return send(415, { error: "INVALID_CONTENT_TYPE" });
      if (Number(request.headers["content-length"] ?? 0) > MAX_BYTES)
        return send(413, { error: "DOCUMENT_TOO_LARGE" });
      if (active) return send(429, { error: "PARSER_BUSY" });
      active = true;
      try {
        const bytes = await readBody(request);
        const parsed = await readers[kind](bytes);
        send(200, parsed);
      } catch (error) {
        // No logs, stack traces, paths, source-bearing diagnostics or arbitrary messages.
        send(
          error instanceof DomainError && error.code === "DOCUMENT_TOO_LARGE"
            ? 413
            : 422,
          {
            error:
              error instanceof DomainError
                ? error.code
                : "DOCUMENT_NOT_READABLE",
          },
        );
      } finally {
        active = false;
      }
    },
  );
}
if (process.env.FAIRSHARE_PARSER_START === "true") {
  await verifyLocalOcrTools();
  const server = createParserServer();
  server.listen(8080, "0.0.0.0");
}
