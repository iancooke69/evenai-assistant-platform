const GATEWAY_NAME = "evenai-ggc-owner-canary-test";
const ASSISTANT_SERVICE = "evenai-ggc-assistant";
const ASSISTANT_URL = "https://getgascert.com/api/assistant/v1/assist";
const ASSIST_PATH = "/api/assist";

function baseHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-evenai-owner-test-gateway": GATEWAY_NAME,
    ...extra,
  };
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders({
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function page() {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Protected GetGasCert canary test</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09213d; color: #09213d; padding: 1rem; }
    main { width: min(720px, 100%); background: #fff; border-radius: 1.25rem; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,.32); }
    header { padding: 1.25rem 1.35rem; background: #09213d; color: #fff; border: 1px solid rgba(255,255,255,.35); }
    header p { margin: .3rem 0 0; color: #9ee5a5; font-weight: 800; }
    h1 { margin: 0; font-size: clamp(1.35rem, 4vw, 2rem); }
    section { padding: 1.2rem; }
    .notice { margin: 0 0 1rem; padding: .85rem; border-radius: .75rem; background: #eef6ef; line-height: 1.45; }
    label { display: block; margin: .75rem 0 .35rem; font-weight: 800; }
    input, textarea { width: 100%; border: 1px solid #9aabba; border-radius: .7rem; padding: .8rem; font: inherit; color: #09213d; }
    textarea { min-height: 110px; resize: vertical; }
    button { margin-top: .8rem; min-height: 48px; padding: 0 1.1rem; border: 0; border-radius: .7rem; background: #19841f; color: #fff; font: inherit; font-weight: 900; cursor: pointer; }
    button:disabled { opacity: .65; cursor: wait; }
    #messages { display: grid; gap: .7rem; margin-top: 1rem; max-height: 340px; overflow: auto; }
    .message { padding: .8rem; border-radius: .8rem; white-space: pre-wrap; line-height: 1.45; }
    .user { background: #dff3e1; }
    .assistant { background: #f2f5f8; border: 1px solid #d4dde5; }
    .status { color: #52657f; font-size: .85rem; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Protected GetGasCert canary test</h1>
      <p>Directly pinned to the enabled canary. Public traffic remains 95% disabled / 5% canary.</p>
    </header>
    <section>
      <p class="notice">Enter the private owner token supplied separately. It is kept in this browser tab only and is never placed in the URL.</p>
      <form id="form">
        <label for="token">Owner token</label>
        <input id="token" type="password" autocomplete="off" required>
        <label for="message">Question</label>
        <textarea id="message" maxlength="2000" required placeholder="How much is a CP42 certificate?"></textarea>
        <button id="send" type="submit">Send to protected canary</button>
      </form>
      <div id="messages" aria-live="polite"></div>
    </section>
  </main>
  <script>
    const form = document.getElementById("form");
    const token = document.getElementById("token");
    const message = document.getElementById("message");
    const send = document.getElementById("send");
    const messages = document.getElementById("messages");
    token.value = sessionStorage.getItem("evenai-owner-canary-token") || "";

    function add(text, role) {
      const element = document.createElement("div");
      element.className = "message " + role;
      element.textContent = text;
      messages.appendChild(element);
      messages.scrollTop = messages.scrollHeight;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ownerToken = token.value.trim();
      const question = message.value.trim();
      if (!ownerToken || !question || send.disabled) return;
      sessionStorage.setItem("evenai-owner-canary-token", ownerToken);
      add(question, "user");
      message.value = "";
      send.disabled = true;
      send.textContent = "Checking canary…";

      try {
        const response = await fetch("/api/assist", {
          method: "POST",
          headers: {
            "authorization": "Bearer " + ownerToken,
            "content-type": "application/json",
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({ message: question }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          sessionStorage.removeItem("evenai-owner-canary-token");
          add("Owner token rejected. Re-enter the private token.", "assistant");
        } else if (response.ok && payload?.result?.response?.text) {
          add(payload.result.response.text, "assistant");
          add("Verified canary version: " + (response.headers.get("x-evenai-version-id") || "unknown"), "status");
        } else {
          add(payload.message || payload.error || "The protected canary could not answer.", "assistant");
        }
      } catch {
        add("The protected test gateway could not connect.", "assistant");
      } finally {
        send.disabled = false;
        send.textContent = "Send to protected canary";
        message.focus();
      }
    });
  </script>
</body>
</html>`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function ownerAuthorized(request, env) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const suppliedHash = await sha256Hex(match[1]);
  return constantTimeEqual(suppliedHash, String(env.OWNER_TOKEN_SHA256 ?? "").toLowerCase());
}

function clientAddress(request) {
  const value = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  return value && value.length <= 64 ? value : null;
}

function requiredEnvironment(env) {
  for (const name of [
    "TARGET_WORKER_NAME",
    "TARGET_VERSION_ID",
    "APPROVED_ORIGIN",
    "OWNER_TOKEN_SHA256",
  ]) {
    if (!String(env[name] ?? "").trim()) throw new Error(`${name} is required`);
  }
}

export function createOwnerCanaryTestWorker() {
  return {
    async fetch(request, env = {}) {
      try {
        requiredEnvironment(env);
      } catch {
        return json(503, {
          error: "gateway_not_configured",
          message: "The protected canary test gateway is not configured.",
        });
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(page(), {
          status: 200,
          headers: baseHeaders({ "content-type": "text/html; charset=utf-8" }),
        });
      }

      if (url.pathname !== ASSIST_PATH || request.method !== "POST") {
        return json(404, { error: "not_found" });
      }

      if (!(await ownerAuthorized(request, env))) {
        return json(401, {
          error: "owner_authentication_required",
          message: "A valid owner token is required.",
        }, { "www-authenticate": "Bearer realm=\"GetGasCert protected canary\"" });
      }

      const connectingIp = clientAddress(request);
      if (!connectingIp) {
        return json(503, {
          error: "client_identity_unavailable",
          message: "The protected gateway could not establish a client identity for rate limiting.",
        });
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json(400, { error: "invalid_json", message: "A JSON request body is required." });
      }
      const message = typeof payload?.message === "string" ? payload.message.trim() : "";
      if (!message || message.length > 2000) {
        return json(400, {
          error: "invalid_message",
          message: "The question must contain between 1 and 2,000 characters.",
        });
      }

      const requestId = request.headers.get("x-request-id")?.slice(0, 128)
        || `owner-${crypto.randomUUID()}`;
      const downstreamRequest = new Request(ASSISTANT_URL, {
        method: "POST",
        headers: {
          origin: env.APPROVED_ORIGIN,
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-real-ip": connectingIp,
          "cf-connecting-ip": connectingIp,
          "Cloudflare-Workers-Version-Overrides":
            `${env.TARGET_WORKER_NAME}=\"${env.TARGET_VERSION_ID}\"`,
        },
        body: JSON.stringify({ message }),
      });

      let downstream;
      try {
        downstream = await env.ASSISTANT.fetch(downstreamRequest);
      } catch {
        return json(502, {
          error: "canary_connection_failed",
          message: "The protected gateway could not reach the assistant canary.",
        });
      }

      const observedService = downstream.headers.get("x-evenai-service");
      const observedVersion = downstream.headers.get("x-evenai-version-id");
      if (
        observedService !== ASSISTANT_SERVICE
        || observedVersion !== env.TARGET_VERSION_ID
      ) {
        return json(502, {
          error: "canary_target_mismatch",
          message: "The protected request did not reach the exact canary version.",
        });
      }

      const headers = baseHeaders({
        "content-type": downstream.headers.get("content-type") || "application/json; charset=utf-8",
        "x-evenai-service": observedService,
        "x-evenai-version-id": observedVersion,
        "x-request-id": downstream.headers.get("x-request-id") || requestId,
      });
      return new Response(downstream.body, {
        status: downstream.status,
        statusText: downstream.statusText,
        headers,
      });
    },
  };
}

export default createOwnerCanaryTestWorker();
