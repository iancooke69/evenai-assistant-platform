import { enforceRateLimit } from "../../packages/rate-limit-policy/index.mjs";
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

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(200, {
        ok: true,
        service: "evenai-ggc-assistant",
        publicAssistantEnabled: env.ENABLE_PUBLIC_ASSISTANT === "true",
        rateLimiterConfigured: typeof env.RATE_LIMITER?.limit === "function",
      });
    }

    if (env.ENABLE_PUBLIC_ASSISTANT !== "true") {
      return json(503, {
        error: "assistant_unavailable",
        message: "The assistant endpoint is not enabled.",
      });
    }

    const origin = request.headers.get("origin")?.trim() ?? "";
    if (!origin || !allowedOrigins(env).has(origin)) {
      return json(403, {
        error: "origin_not_allowed",
        message: "This origin is not permitted to access the assistant.",
      }, { vary: "Origin" });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    const rateLimit = await enforceRateLimit(request, env);
    if (!rateLimit.allowed) {
      const status = rateLimit.reason === "rate-limit-exceeded" ? 429 : 503;
      return withCors(json(status, {
        error: rateLimit.reason,
        message: status === 429
          ? "Too many assistant requests. Try again later."
          : "The assistant rate limiter is unavailable.",
      }, {
        "retry-after": String(rateLimit.retryAfter),
      }), origin);
    }

    return withCors(await handleGgcAssistantRequest(request), origin);
  },
};
