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
