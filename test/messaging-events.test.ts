import { MESSAGE_TYPES, Messaging, Path, setupGlobals } from "./messaging-fixture.ts";

beforeEach(() => setupGlobals());

describe("emit.downloaded", () => {
  test("fires a DOWNLOADED message and swallows a no-receiver rejection", async () => {
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error("Receiving end does not exist")),
    );
    const state = {
      path: new Path("."),
      scratch: {},
      info: { url: "https://x/file.png" },
    };

    expect(() => Messaging.emit.downloaded(state)).not.toThrow();
    expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOADED,
      body: { state: { path: ".", info: { url: "https://x/file.png" } } },
    });
    // The rejection is caught, not left unhandled
    await Promise.resolve();
  });
});
