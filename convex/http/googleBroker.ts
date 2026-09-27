import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { issueShortLivedAccess } from "../oauth/access";
import { googleScopesAreBounded } from "../domain/apps";
import { errorResponse, jsonResponse } from "../lib/responses";
import { isPlainObject } from "../lib/json";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]{5,200}$/;
const NON_DOWNLOADABLE_MIME = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.shortcut",
]);
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

type Operation = {
  method: "GET" | "POST" | "PUT";
  url: string;
  body?: string;
  download?: boolean;
};

function nonempty(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function jsonBody(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const serialized = JSON.stringify(value);
  return serialized.length <= MAX_REQUEST_BYTES ? serialized : null;
}

export function operationFor(input: Record<string, unknown>): Operation | null {
  const id = input.id;
  const payload = input.payload;
  switch (input.operation) {
    case "drive.list": {
      const pageSize = input.pageSize === undefined ? 50 : input.pageSize;
      if (
        !Number.isInteger(pageSize) ||
        (pageSize as number) < 1 ||
        (pageSize as number) > 100
      )
        return null;
      if (input.pageToken !== undefined && !nonempty(input.pageToken, 2048))
        return null;
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set(
        "q",
        `trashed = false and mimeType != '${SHORTCUT_MIME}'`,
      );
      url.searchParams.set(
        "fields",
        "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      );
      url.searchParams.set("pageSize", String(pageSize));
      if (input.pageToken)
        url.searchParams.set("pageToken", input.pageToken as string);
      return { method: "GET", url: url.toString() };
    }
    case "drive.metadata":
    case "drive.download": {
      if (!nonempty(id) || !FILE_ID.test(id)) return null;
      return {
        method: "GET",
        url: `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size,modifiedTime`,
        download: input.operation === "drive.download",
      };
    }
    case "docs.get":
      if (!nonempty(id) || !FILE_ID.test(id)) return null;
      return {
        method: "GET",
        url: `https://docs.googleapis.com/v1/documents/${id}`,
      };
    case "docs.create": {
      const body = jsonBody(payload);
      return body === null
        ? null
        : {
            method: "POST",
            url: "https://docs.googleapis.com/v1/documents",
            body,
          };
    }
    case "docs.batchUpdate":
      if (!nonempty(id) || !FILE_ID.test(id)) return null;
      {
        const body = jsonBody(payload);
        return body === null
          ? null
          : {
              method: "POST",
              url: `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`,
              body,
            };
      }
    case "sheets.get":
      if (!nonempty(id) || !FILE_ID.test(id)) return null;
      return {
        method: "GET",
        url: `https://sheets.googleapis.com/v4/spreadsheets/${id}`,
      };
    case "sheets.create": {
      const body = jsonBody(payload);
      return body === null
        ? null
        : {
            method: "POST",
            url: "https://sheets.googleapis.com/v4/spreadsheets",
            body,
          };
    }
    case "sheets.values.get":
      if (!nonempty(id) || !FILE_ID.test(id) || !nonempty(input.range, 500))
        return null;
      return {
        method: "GET",
        url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(input.range)}`,
      };
    case "sheets.values.update":
      if (!nonempty(id) || !FILE_ID.test(id) || !nonempty(input.range, 500))
        return null;
      {
        const body = jsonBody(payload);
        return body === null
          ? null
          : {
              method: "PUT",
              url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(input.range)}?valueInputOption=USER_ENTERED`,
              body,
            };
      }
    default:
      return null;
  }
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function googleFetch(
  operation: Operation,
  token: string,
): Promise<Response> {
  return await fetch(operation.url, {
    method: operation.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(operation.body ? { "Content-Type": "application/json" } : {}),
    },
    body: operation.body,
    redirect: "manual",
  });
}

function googleError(status: number): Response {
  if (status === 429 || status >= 500) {
    return errorResponse(
      502,
      "Google operation temporarily unavailable",
      "PROVIDER_ERROR",
    );
  }
  if (status === 401 || status === 403) {
    return errorResponse(403, "Google grant unavailable", "APP_UNAVAILABLE");
  }
  return errorResponse(400, "Google rejected the operation", "INVALID_REQUEST");
}

export const httpGoogleBrokerHandler = httpAction(async (ctx, request) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return errorResponse(413, "Request too large", "INVALID_REQUEST");
  }
  const requestBytes = await readBounded(request.body, MAX_REQUEST_BYTES);
  if (!requestBytes) {
    return errorResponse(413, "Request too large", "INVALID_REQUEST");
  }
  const raw = new TextDecoder().decode(requestBytes);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return errorResponse(400, "Invalid JSON", "INVALID_REQUEST");
  }
  if (!isPlainObject(input) || !nonempty(input.brokerToken, 70)) {
    return errorResponse(400, "brokerToken is required", "INVALID_REQUEST");
  }
  const authorized = await ctx.runMutation(
    internal.tables.slices.googleBroker.authorizeOperation,
    { brokerToken: input.brokerToken, charge: true },
  );
  if (!authorized.ok)
    return errorResponse(authorized.status, authorized.reason, authorized.code);
  const operation = operationFor(input);
  if (!operation)
    return errorResponse(
      400,
      "Unsupported operation or parameters",
      "INVALID_REQUEST",
    );
  const minted = await issueShortLivedAccess(
    ctx,
    authorized.userId,
    authorized.app,
    authorized.connectionId,
    "server",
  );
  if ("error" in minted)
    return errorResponse(
      minted.code === "APP_UNAVAILABLE" ? 403 : 503,
      minted.code === "PROVIDER_ERROR"
        ? "Google connection is busy; retry shortly"
        : "Google connection unavailable",
      minted.code,
    );
  if (!googleScopesAreBounded(authorized.app, minted.grantedScopes)) {
    return errorResponse(
      403,
      "Google token scopes unavailable or mismatched",
      "APP_UNAVAILABLE",
    );
  }
  if (minted.expiresAt !== null && minted.expiresAt <= Date.now()) {
    return errorResponse(403, "Google token expired", "APP_UNAVAILABLE");
  }
  // Refresh can race with disconnect or revocation. Check again before any upstream call.
  const current = await ctx.runMutation(
    internal.tables.slices.googleBroker.authorizeOperation,
    { brokerToken: input.brokerToken, charge: false },
  );
  if (!current.ok)
    return errorResponse(current.status, current.reason, current.code);
  try {
    const upstream = await googleFetch(operation, minted.accessToken);
    if (!upstream.ok) return googleError(upstream.status);
    const bytes = await readBounded(upstream.body);
    if (!bytes)
      return errorResponse(
        413,
        "Google response exceeds broker limit",
        "INVALID_REQUEST",
      );
    if (
      input.operation === "drive.list" ||
      input.operation === "drive.metadata" ||
      input.operation === "drive.download"
    ) {
      const metadata = JSON.parse(new TextDecoder().decode(bytes));
      if (!isPlainObject(metadata) && operation.download)
        return errorResponse(502, "Invalid Drive metadata", "APP_UNAVAILABLE");
      if (operation.download || input.operation === "drive.metadata") {
        if (
          !isPlainObject(metadata) ||
          typeof metadata.mimeType !== "string" ||
          (operation.download
            ? NON_DOWNLOADABLE_MIME.has(metadata.mimeType)
            : metadata.mimeType === SHORTCUT_MIME)
        ) {
          return errorResponse(
            403,
            "File type is unavailable through Drive",
            "APP_UNAVAILABLE",
          );
        }
      }
      if (operation.download) {
        const url = new URL(operation.url);
        url.search = "?alt=media";
        const content = await googleFetch(
          { method: "GET", url: url.toString() },
          minted.accessToken,
        );
        if (!content.ok) return googleError(content.status);
        const file = await readBounded(content.body, 384 * 1024);
        if (!file)
          return errorResponse(
            413,
            "Google response exceeds broker limit",
            "INVALID_REQUEST",
          );
        let binary = "";
        for (const byte of file) binary += String.fromCharCode(byte);
        return jsonResponse(200, {
          app: "files",
          operation: "drive.download",
          mimeType: metadata.mimeType,
          contentBase64: btoa(binary),
        });
      }
      if (input.operation === "drive.list") {
        if (!isPlainObject(metadata) || !Array.isArray(metadata.files))
          return errorResponse(502, "Invalid Drive listing", "APP_UNAVAILABLE");
        metadata.files = metadata.files.filter(
          (file) =>
            isPlainObject(file) &&
            typeof file.mimeType === "string" &&
            file.mimeType !== SHORTCUT_MIME,
        );
        return jsonResponse(200, {
          app: "files",
          operation: input.operation,
          data: metadata,
        });
      }
    }
    return jsonResponse(200, {
      app: authorized.app,
      operation: input.operation,
      data: JSON.parse(new TextDecoder().decode(bytes)),
    });
  } catch {
    return errorResponse(
      502,
      "Google operation unavailable",
      "APP_UNAVAILABLE",
    );
  }
});
