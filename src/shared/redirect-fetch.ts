export const DEFAULT_FETCH_RESPONSE_TIMEOUT_MS = 30_000;

export const fetchFollowingRedirects = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  responseTimeoutMs?: number,
): Promise<Response> => {
  if (responseTimeoutMs === undefined) {
    return fetch(input, { ...init, redirect: "follow" });
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          `No response headers received within ${responseTimeoutMs} ms`,
          "TimeoutError",
        ),
      ),
    responseTimeoutMs,
  );

  try {
    return await fetch(input, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
};
