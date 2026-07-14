import { createE2EControlClient } from "../e2e/control-client.mjs";

describe("structured E2E control client", () => {
  test("passes data as arguments instead of interpolating executable expressions", async () => {
    const calls: Array<{ declaration: string; args: unknown[] | undefined }> = [];
    const callFunction = vi.fn(async (declaration: string, args?: unknown[]) => {
      calls.push({ declaration, args });
      return JSON.stringify({ ok: true, value: { type: "OK" } });
    });
    const client = createE2EControlClient({ callFunction });
    const value = 'folder/"quoted"/${notExecutable}';

    await client.storage.local.set({ paths: value });

    expect(callFunction).toHaveBeenCalledOnce();
    expect(calls[0]?.declaration).not.toContain(value);
    expect(calls[0]?.args).toEqual([
      { operation: "storage.set", area: "local", values: { paths: value } },
    ]);
    expect(client.metrics()).toEqual({ structuredCalls: 1 });
  });

  test("reports browser-side operation failures with their original message", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: false,
          error: { message: "downloads API unavailable", stack: "remote stack" },
        }),
    });

    await expect(client.downloads.search()).rejects.toThrow("downloads API unavailable");
  });

  test("uses production runtime messages for option changes", async () => {
    const requests: unknown[] = [];
    const client = createE2EControlClient({
      callFunction: async (_declaration, args) => {
        requests.push(args?.[0]);
        return JSON.stringify({ ok: true, value: { type: "OK" } });
      },
    });

    await client.options.set({ promptOnShift: true });

    expect(requests).toEqual([
      {
        operation: "storage.set",
        area: "local",
        values: { promptOnShift: true },
      },
      {
        operation: "runtime.send",
        message: { type: "OPTIONS_LOADED" },
      },
    ]);
  });
});
