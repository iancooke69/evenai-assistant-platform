import { enforceRateLimit } from "../../packages/rate-limit-policy/index.mjs";
import { createTelemetryEvent, recordTelemetry } from "../../packages/telemetry-policy/index.mjs";
import { handleGgcAssistantRequest } from "./http.mjs";

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function allowedOrigins(env = {}) {
  return new Set(
    String(env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-request-id",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function finish(response, outcome, startedAt, env, ctx, requestId = null) {
  const event = createTelemetryEvent({
    outcome,
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestId,
  });
  const write = recordTelemetry(env.TELEMETRY, event);
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
  return response;
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const startedAt = Date.now();
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return finish(json(200, {
        ok: true,
        service: "evenai-ggc-assistant",
        publicAssistantEnabled: env.ENABLE_PUBLIC_ASSISTANT === "true",
        rateLimiterConfigured: typeof env.RATE_LIMITER?.limit === "function",
        telemetryConfigured: typeof env.TELEMETRY?.write === "function",
      }), "health", startedAt, env, ctx);
    }

    if (env.ENABLE_PUBLIC_ASSISTANT !== "true") {
      return finish(json(503, {
        error: "assistant_unavailable",
        message: "The assistant endpoint is not enabled.",
      }), "disabled", startedAt, env, ctx);
    }

    const origin = request.headers.get("origin")?.trim() ?? "";
    if (!origin || !allowedOrigins(env).has(origin)) {
      return finish(json(403, {
        error: "origin_not_allowed",
        message: "This origin is not permitted to access the assistant.",
      }, { vary: "Origin" }), "origin-rejected", startedAt, env, ctx);
    }

    if (request.method === "OPTIONS") {
      return finish(new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      }), "preflight", startedAt, env, ctx);
    }

    const rateLimit = await enforceRateLimit(request, env);
    if (!rateLimit.allowed) {
      const status = rateLimit.reason === "rate-limit-exceeded" ? 429 : 503;
      const response = withCors(json(status, {
        error: rateLimit.reason,
        message: status === 429
          ? "Too many assistant requests. Try again later."
          : "The assistant rate limiter is unavailable.",
      }, {
        "retry-after": String(rateLimit.retryAfter),
      }), origin);
      return finish(
        response,
        status === 429 ? "rate-limited" : "limiter-unavailable",
        startedAt,
        env,
        ctx,
        request.headers.get("x-request-id"),
      );
    }

    const response = withCors(await handleGgcAssistantRequest(request), origin);
    return finish(
      response,
      "assistant-response",
      startedAt,
      env,
      ctx,
      response.headers.get("x-request-id") ?? request.headers.get("x-request-id"),
    );
  },
};
