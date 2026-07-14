import { createOptionsRuntime, type OptionsRuntimeApi } from "../src/options/options-runtime.ts";
import { routingPorts } from "../src/routing/ports.ts";
import { COUNTER_KEY } from "../src/shared/storage-keys.ts";

describe("options runtime adapter", () => {
  test("caches schema requests and preserves conditional apply payloads", async () => {
    const sendMessage = vi.fn((message: unknown) =>
      Promise.resolve(
        Reflect.get(message as object, "type") === "OPTIONS_SCHEMA"
          ? { body: { keys: [], types: { BOOL: "BOOL", VALUE: "VALUE" } } }
          : { body: {} },
      ),
    );
    const api = {
      runtime: { sendMessage },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn(() => Promise.resolve({ [COUNTER_KEY]: 7 })) } },
    } satisfies OptionsRuntimeApi;
    const runtime = createOptionsRuntime(api);

    await Promise.all([runtime.getSchema(), runtime.getSchema()]);
    await runtime.apply({ paths: "." }, { paths: "images" });
    await runtime.apply({ links: true });
    runtime.configure();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: "APPLY_CONFIG",
      body: { config: { paths: "." }, expected: { paths: "images" } },
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: "APPLY_CONFIG",
      body: { config: { links: true } },
    });
    await expect(routingPorts.peekCounter()).resolves.toBe(7);
  });

  test("normalizes an invalid persisted counter after configuration", async () => {
    const api = {
      runtime: { sendMessage: vi.fn() },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn(() => Promise.resolve({ [COUNTER_KEY]: -1 })) } },
    } satisfies OptionsRuntimeApi;
    createOptionsRuntime(api).configure();

    await expect(routingPorts.peekCounter()).resolves.toBe(0);
  });

  test("retries schema loading after a transient background failure", async () => {
    const schema = { keys: [], types: { BOOL: "BOOL", VALUE: "VALUE" } };
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker restarting"))
      .mockResolvedValueOnce({ body: schema });
    const api = {
      runtime: { sendMessage },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn() } },
    } satisfies OptionsRuntimeApi;
    const runtime = createOptionsRuntime(api);

    await expect(runtime.getSchema()).rejects.toThrow("worker restarting");
    await expect(runtime.getSchema()).resolves.toEqual(schema);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test("does not cache a malformed schema response", async () => {
    const schema = { keys: [], types: { BOOL: "BOOL", VALUE: "VALUE" } };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ body: { keys: "invalid" } })
      .mockResolvedValueOnce({ body: schema });
    const api = {
      runtime: { sendMessage },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn() } },
    } satisfies OptionsRuntimeApi;
    const runtime = createOptionsRuntime(api);

    await expect(runtime.getSchema()).rejects.toThrow("Invalid option schema");
    await expect(runtime.getSchema()).resolves.toEqual(schema);
  });

  test("rejects a primitive schema response", async () => {
    const api = {
      runtime: { sendMessage: vi.fn().mockResolvedValue("invalid") },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn() } },
    } satisfies OptionsRuntimeApi;

    await expect(createOptionsRuntime(api).getSchema()).rejects.toThrow("Invalid option schema");
  });

  test("rejects non-primitive option defaults at the message boundary", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      body: {
        keys: [{ name: "paths", type: "VALUE", default: { nested: true } }],
        types: { BOOL: "BOOL", VALUE: "VALUE" },
      },
    });
    const api = {
      runtime: { sendMessage },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn() } },
    } satisfies OptionsRuntimeApi;

    await expect(createOptionsRuntime(api).getSchema()).rejects.toThrow("Invalid option schema");
  });

  test.each([
    {
      keys: [{ name: "paths", type: "UNKNOWN", default: "." }],
      types: { BOOL: "BOOL", VALUE: "VALUE" },
    },
    {
      keys: [{ name: "limit", type: "VALUE", default: Number.NaN }],
      types: { BOOL: "BOOL", VALUE: "VALUE" },
    },
    { keys: [], types: { BOOL: "", VALUE: "VALUE" } },
    { keys: [], types: { BOOL: "OPTION", VALUE: "OPTION" } },
  ])("rejects a schema that cannot safely drive option controls %#", async (body) => {
    const api = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ body }) },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn() } },
    } satisfies OptionsRuntimeApi;

    await expect(createOptionsRuntime(api).getSchema()).rejects.toThrow("Invalid option schema");
  });
});
