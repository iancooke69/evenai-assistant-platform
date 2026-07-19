function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function clientKey(request) {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  return address || null;
}

export async function enforceRateLimit(request, env = {}) {
  const key = clientKey(request);
  if (!key) {
    return {
      allowed: false,
      reason: "client-identity-unavailable",
      retryAfter: 60,
    };
  }

  const limiter = env.RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return {
      allowed: false,
      reason: "rate-limiter-unavailable",
      retryAfter: 60,
    };
  }

  const result = await limiter.limit({ key });
  const allowed = result?.success === true;

  return {
    allowed,
    reason: allowed ? null : "rate-limit-exceeded",
    retryAfter: positiveInteger(env.RATE_LIMIT_RETRY_AFTER_SECONDS, 60),
  };
}
