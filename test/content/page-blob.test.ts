import { servePageBlob } from "../../src/content/page-blob.ts";
import { isPageBlobUrl, PAGE_BLOB_PORT, PAGE_BLOB_TIMEOUT_MS } from "../../src/shared/page-blob.ts";
import { webExtensionEvent } from "../support/webextension-host.fixture.ts";

const url = "blob:https://page.test/id";

const makeServer = () => {
  const port = {
    name: PAGE_BLOB_PORT,
    sender: { id: chrome.runtime.id },
    onMessage: webExtensionEvent<[unknown]>(),
    onDisconnect: webExtensionEvent(),
    postMessage: vi.fn<(message: unknown) => void>(),
    disconnect: vi.fn(),
  };
  servePageBlob(port as unknown as chrome.runtime.Port);
  return port;
};

beforeEach(() => {
  vi.stubGlobal("location", { origin: "https://page.test" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("abc", { headers: { "Content-Type": "image/png" } })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("ignores other ports", () => {
  const port = { name: "other", onMessage: webExtensionEvent(), disconnect: vi.fn() };
  servePageBlob(port as unknown as chrome.runtime.Port);
  expect(port.onMessage.hasListeners()).toBe(false);
});

test("refuses a request from a tab instead of the background", () => {
  const port = {
    name: PAGE_BLOB_PORT,
    sender: { id: chrome.runtime.id, tab: {} },
    disconnect: vi.fn(),
  };
  servePageBlob(port as unknown as chrome.runtime.Port);
  expect(port.disconnect).toHaveBeenCalledOnce();
});

test.each([
  ["a read before open", { type: "read" }],
  ["a malformed request", null],
])("reports %s as a refusal without a reason", async (_name, message) => {
  const port = makeServer();
  port.onMessage.emit(message);
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "error" }));
  expect(port.onMessage.hasListeners()).toBe(false);
  expect(port.disconnect).not.toHaveBeenCalled();
});

test("closes a port whose background sends a second request before a reply", () => {
  const port = makeServer();
  port.onMessage.emit({ type: "open", url });
  port.onMessage.emit({ type: "read" });
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(port.onMessage.hasListeners()).toBe(false);
});

test("closes the port itself when the background cannot take the report", async () => {
  const port = makeServer();
  port.postMessage.mockImplementation(() => {
    throw new Error("Port disconnected");
  });
  port.onMessage.emit({ type: "read" });
  await vi.waitFor(() => expect(port.disconnect).toHaveBeenCalledOnce());
});

test("closes an idle transfer after a bounded wait", async () => {
  vi.useFakeTimers();
  const port = makeServer();
  await vi.advanceTimersByTimeAsync(PAGE_BLOB_TIMEOUT_MS);
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(port.onMessage.hasListeners()).toBe(false);
});

test("stops quietly when the background leaves mid-request", async () => {
  const port = makeServer();
  port.onMessage.emit({ type: "open", url });
  port.onDisconnect.emit();
  await Promise.resolve();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(port.postMessage).not.toHaveBeenCalled();
});

test("drops a chunk read the background abandoned", async () => {
  const port = makeServer();
  port.onMessage.emit({ type: "open", url });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce());
  port.onMessage.emit({ type: "read" });
  port.onDisconnect.emit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(port.postMessage).toHaveBeenCalledOnce();
});

test("rejects unparseable URLs as page blobs", () => {
  expect(isPageBlobUrl("not a url")).toBe(false);
});
