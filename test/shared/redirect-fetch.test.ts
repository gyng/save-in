import { options } from "../../src/config/options-data.ts";
import { fetchFollowingRedirects } from "../../src/shared/redirect-fetch.ts";

describe("redirect-aware extension fetches", () => {
  beforeEach(() => {
    options.includeFetchCredentials = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("uses the native follow mode when no response timeout is requested", async () => {
    const response = new Response("ok");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);

    await expect(fetchFollowingRedirects("https://example.test/file")).resolves.toBe(response);
    expect(fetcher).toHaveBeenCalledWith("https://example.test/file", { redirect: "follow" });
  });

  test("forwards an already-aborted caller signal", async () => {
    const caller = new AbortController();
    caller.abort(new DOMException("caller stopped", "AbortError"));
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });

    await expect(
      fetchFollowingRedirects("https://example.test/file", { signal: caller.signal }, 100),
    ).rejects.toThrow("caller stopped");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
