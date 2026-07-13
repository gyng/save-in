import { createOptionsRuntime } from "../src/options/options-runtime.ts";
import { routingPorts } from "../src/routing/ports.ts";
import { COUNTER_KEY } from "../src/shared/storage-keys.ts";

describe("options runtime adapter", () => {
  test("caches schema requests and preserves conditional apply payloads", async () => {
    const sendMessage = vi.fn(({ type }) =>
      Promise.resolve(type === "OPTIONS_SCHEMA" ? { body: { keys: [], types: {} } } : { body: {} }),
    );
    const api = {
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
      i18n: { getMessage: (key: string) => key },
      storage: { local: { get: vi.fn(() => Promise.resolve({ [COUNTER_KEY]: 7 })) } },
    } as any;
    const runtime = createOptionsRuntime(api);

    await Promise.all([runtime.getSchema(), runtime.getSchema()]);
    await runtime.apply({ paths: "." }, { paths: "images" });
    runtime.configure();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "APPLY_CONFIG",
      body: { config: { paths: "." }, expected: { paths: "images" } },
    });
    await expect(routingPorts.peekCounter()).resolves.toBe(7);
  });
});
