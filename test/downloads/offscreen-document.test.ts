// The offscreen document's message contract: HTTP failures carry the status
// and redirected final URL so the background can extend Referer protection
// and retry (#193).
import "../../src/offscreen/offscreen.ts";

type OffscreenListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean;

const capturedListener = (): OffscreenListener =>
  vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0] as OffscreenListener;

const dispatchFetch = async (requestId: string): Promise<ReturnType<typeof vi.fn>> => {
  const sendResponse = vi.fn();
  const handled = capturedListener()(
    { type: "OFFSCREEN_FETCH", url: "https://cdn.example/file", requestId },
    {} as chrome.runtime.MessageSender,
    sendResponse,
  );
  expect(handled).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  return sendResponse;
};

const dispatchPrompt = async (input: string): Promise<ReturnType<typeof vi.fn>> => {
  const sendResponse = vi.fn();
  const handled = capturedListener()(
    { type: "OFFSCREEN_PROMPT", input },
    {} as chrome.runtime.MessageSender,
    sendResponse,
  );
  expect(handled).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  return sendResponse;
};

afterEach(() => Reflect.deleteProperty(globalThis, "LanguageModel"));

test("runs document-only prompts and destroys the session", async () => {
  const destroy = vi.fn();
  Reflect.set(globalThis, "LanguageModel", {
    availability: vi.fn(async () => "available"),
    create: vi.fn(async () => ({
      prompt: vi.fn(async () => "into: suggested/"),
      destroy,
    })),
  });

  const sendResponse = await dispatchPrompt("Suggest a rule");

  expect(sendResponse).toHaveBeenCalledWith({ output: "into: suggested/" });
  expect(destroy).toHaveBeenCalledOnce();
});

test("reports unavailable and failed prompts without escaping the listener", async () => {
  const unavailable = await dispatchPrompt("Suggest a rule");
  expect(unavailable).toHaveBeenCalledWith({ output: null });

  Reflect.set(globalThis, "LanguageModel", {
    availability: vi.fn(async () => "available"),
    create: vi.fn(async () => {
      throw new DOMException("session destroyed", "InvalidStateError");
    }),
  });
  const failed = await dispatchPrompt("Suggest another rule");
  expect(failed).toHaveBeenCalledWith({ error: "InvalidStateError: session destroyed" });
});

test("reports HTTP failure status and final URL for Referer extension", async () => {
  const failed = new Response("denied", { status: 403 });
  Object.defineProperty(failed, "url", { value: "https://s3.example/file?sig=1" });
  const cancel = vi.spyOn(failed.body!, "cancel");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(failed);

  const sendResponse = await dispatchFetch("failure-detail");

  expect(sendResponse).toHaveBeenCalledWith({
    error: "HTTP 403",
    status: 403,
    finalUrl: "https://s3.example/file?sig=1",
  });
  // The failure body must not keep its connection alive across a retry.
  expect(cancel).toHaveBeenCalled();
});

test("omits an empty final URL and keeps plain errors unchanged", async () => {
  const failed = new Response("denied", { status: 500 });
  Object.defineProperty(failed, "url", { value: "" });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(failed);
  const failureResponse = await dispatchFetch("no-final-url");
  expect(failureResponse).toHaveBeenCalledWith({ error: "HTTP 500", status: 500 });

  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  const networkResponse = await dispatchFetch("network-error");
  expect(networkResponse).toHaveBeenCalledWith({ error: "Failed to fetch" });
});
