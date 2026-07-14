import { Sha256 } from "./sha256.ts";

type StreamableResponse = Pick<Response, "body" | "headers"> &
  (Pick<Response, "arrayBuffer"> | Pick<Response, "blob">);

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted", "AbortError");

const runAbortable = async <T>(signal: AbortSignal | undefined, operation: () => Promise<T>) => {
  if (!signal) return operation();
  if (signal.aborted) throw abortError(signal);
  let rejectOnAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort?.(abortError(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

export const readResponseContent = async (
  response: StreamableResponse,
  hash: boolean,
  signal?: AbortSignal,
): Promise<{ blob: Blob; sha256: string }> => {
  // SHA-256 state is updated incrementally, so hashing does not allocate a
  // second full-file buffer. The chunks still have to be retained once to make
  // a Blob because WebExtension downloads accept a URL, not a byte stream.
  // Consequently browser Blob/memory limits still apply to exceptionally large
  // files; there is deliberately no arbitrary extension-side size cutoff.
  const chunks: ArrayBuffer[] = [];
  const sha256 = hash ? new Sha256() : undefined;
  const contentType = response.headers?.get?.("Content-Type") ?? "";

  if (response.body) {
    const reader = response.body.getReader();
    const cancelPendingRead = () => {
      void reader.cancel(abortError(signal!)).catch(() => {});
    };
    signal?.addEventListener("abort", cancelPendingRead, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw abortError(signal);
        const { done, value } = await reader.read();
        if (signal?.aborted) throw abortError(signal);
        if (done) break;
        const chunk = new Uint8Array(value);
        chunks.push(chunk.buffer);
        sha256?.update(chunk);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancelPendingRead);
      reader.releaseLock();
    }
  } else {
    const buffer = await runAbortable(signal, () =>
      "arrayBuffer" in response
        ? response.arrayBuffer()
        : response.blob().then((blob) => blob.arrayBuffer()),
    );
    const chunk = new Uint8Array(buffer);
    chunks.push(chunk.buffer);
    sha256?.update(chunk);
  }

  if (signal?.aborted) throw abortError(signal);
  return { blob: new Blob(chunks, { type: contentType }), sha256: sha256?.hex() ?? "" };
};
