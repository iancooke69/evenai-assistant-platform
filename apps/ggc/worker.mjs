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

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(200, {
        ok: true,
        service: "evenai-ggc-assistant",
        publicAssistantEnabled: env.ENABLE_PUBLIC_ASSISTANT === "true",
      });
    }

    if (env.ENABLE_PUBLIC_ASSISTANT !== "true") {
      return json(503, {
        error: "assistant_unavailable",
        message: "The assistant endpoint is not enabled.",
      });
    }

    return handleGgcAssistantRequest(request);
  },
};
