import { readResponseContent } from "../src/shared/streaming-content.ts";

test("hashes response chunks incrementally while retaining bytes for the download blob", async () => {
  const chunks = [new TextEncoder().encode("a"), new TextEncoder().encode("bc")];
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    }),
    { headers: { "Content-Type": "text/plain" } },
  );
  const digest = vi.spyOn(crypto.subtle, "digest");

  const content = await readResponseContent(response, true);

  expect(content.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(content.blob.type).toBe("text/plain");
  expect(await content.blob.text()).toBe("abc");
  expect(digest).not.toHaveBeenCalled();
});

test("propagates stream cancellation instead of returning partial content", async () => {
  const controller = new AbortController();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new Uint8Array([1, 2, 3]));
        controller.abort();
      },
    }),
  );

  await expect(readResponseContent(response, true, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

test("cancels a pending stream read immediately when aborted", async () => {
  const controller = new AbortController();
  let cancelCalled = false;
  let markPullStarted!: () => void;
  const pullStarted = new Promise<void>((resolve) => {
    markPullStarted = resolve;
  });
  const response = new Response(
    new ReadableStream({
      pull() {
        markPullStarted();
      },
      cancel() {
        cancelCalled = true;
      },
    }),
  );

  const content = readResponseContent(response, true, controller.signal);
  await pullStarted;
  controller.abort(new DOMException("Canceled", "AbortError"));

  await expect(content).rejects.toMatchObject({ name: "AbortError" });
  expect(cancelCalled).toBe(true);
});

test("uses a blob fallback without hashing when no stream or arrayBuffer method exists", async () => {
  const response = {
    body: null,
    headers: new Headers({ "Content-Type": "application/octet-stream" }),
    blob: () => Promise.resolve(new Blob(["fallback"])),
  };

  const content = await readResponseContent(response, false);

  expect(await content.blob.text()).toBe("fallback");
  expect(content.sha256).toBe("");
});

test("checks cancellation after a non-stream body read", async () => {
  const controller = new AbortController();
  const response = {
    body: null,
    headers: new Headers(),
    arrayBuffer: async () => {
      controller.abort();
      return new ArrayBuffer(0);
    },
  };

  await expect(readResponseContent(response, false, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

test("rejects a pending non-stream body read as soon as it is aborted", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Canceled", "AbortError");
  let finishRead!: (buffer: ArrayBuffer) => void;
  const response = {
    body: null,
    headers: new Headers(),
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finishRead = resolve;
      }),
  };
  const outcome = readResponseContent(response, false, controller.signal).then(
    () => "resolved",
    (error: unknown) => error,
  );

  controller.abort(reason);
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await expect(Promise.race([outcome, Promise.resolve("still pending")])).resolves.toBe(reason);
  } finally {
    finishRead(new ArrayBuffer(0));
  }
});

test("preserves a read failure when reader cancellation also rejects", async () => {
  const readFailure = new Error("stream failed");
  const reader = {
    read: vi.fn(() => Promise.reject(readFailure)),
    cancel: vi.fn(() => Promise.reject(new Error("cancel failed"))),
    releaseLock: vi.fn(),
  };
  const response = {
    body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
    headers: new Headers(),
  };

  await expect(readResponseContent(response as unknown as Response, true)).rejects.toBe(
    readFailure,
  );
  expect(reader.cancel).toHaveBeenCalledWith(readFailure);
  expect(reader.releaseLock).toHaveBeenCalledOnce();
});

test("contains cancellation rejection from the abort listener", async () => {
  const controller = new AbortController();
  let rejectRead!: (error: Error) => void;
  const reader = {
    read: vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRead = reject;
        }),
    ),
    cancel: vi.fn(() => Promise.reject(new Error("cancel failed"))),
    releaseLock: vi.fn(),
  };
  const response = {
    body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
    headers: new Headers(),
  };

  const content = readResponseContent(response as unknown as Response, false, controller.signal);
  controller.abort();
  rejectRead(new Error("read stopped"));

  await expect(content).rejects.toThrow("read stopped");
  expect(reader.cancel).toHaveBeenCalled();
});

test("creates a standard abort error when a signal-like host omits its reason", async () => {
  const signal = {
    aborted: true,
    reason: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as AbortSignal;

  await expect(
    readResponseContent(
      { body: null, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) },
      false,
      signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});
