const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function generatedRequestId() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") {
    return randomUuid.call(globalThis.crypto);
  }

  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function requestId(request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : generatedRequestId();
}

function acceptedRoutes(options) {
  const configured = options.routes ?? options.route ?? "/v1/assist";
  const values = Array.isArray(configured) ? configured : [configured];
  if (
    values.length === 0
    || values.some((value) => typeof value !== "string" || !value.startsWith("/"))
  ) {
    throw new TypeError("route or routes must contain one or more absolute paths");
  }
  return new Set(values);
}

export function createAssistantHttpHandler(options = {}) {
  if (typeof options.assistant !== "function") {
    throw new TypeError("assistant must be a function");
  }

  const routes = acceptedRoutes(options);
  const maximumInputLength = Number.isInteger(options.maximumInputLength)
    ? options.maximumInputLength
    : 2000;

  return async function handle(request) {
    const id = requestId(request);
    const url = new URL(request.url);

    if (!routes.has(url.pathname)) {
      return json(404, { error: "not-found", requestId: id });
    }

    if (request.method !== "POST") {
      return json(405, { error: "method-not-allowed", requestId: id }, { allow: "POST" });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json(415, { error: "unsupported-media-type", requestId: id });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid-json", requestId: id });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid-body", requestId: id });
    }

    if (typeof body.message !== "string") {
      return json(400, { error: "message-required", requestId: id });
    }

    if (body.message.length > maximumInputLength) {
      return json(413, { error: "message-too-long", requestId: id });
    }

    try {
      const result = await options.assistant(body.message);
      return json(200, { requestId: id, result });
    } catch {
      return json(500, { error: "assistant-failure", requestId: id });
    }
  };
}
