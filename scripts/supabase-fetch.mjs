export function createTimeoutFetch(timeoutMs = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? 90000)) {
  return async function timeoutFetch(input, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = init.signal;

    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}
