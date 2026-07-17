import { WEBHOOK_TARGET_LIMIT } from "../../../src/shared/webhook.ts";
import { applyConfigSerialized } from "../../../src/background/config-apply.ts";
import { OPTION_DEFAULTS } from "../../../src/config/option-defaults.ts";
import { OptionsManagement } from "../../../src/config/option.ts";

test("keeps every webhook option disabled or privacy-minimal by default", () => {
  expect(OPTION_DEFAULTS).toMatchObject({
    webhookEnabled: false,
    webhookUrl: "",
    webhookIncludePageUrl: false,
    webhookIncludePageTitle: false,
    webhookIncludeSelectionText: false,
  });
});

test("normalizes a valid HTTPS endpoint and rejects unsafe endpoints", async () => {
  const storage = { get: vi.fn(), set: vi.fn(async () => {}) };
  const reset = vi.fn(async () => {});

  await expect(
    applyConfigSerialized(
      { queue: Promise.resolve() },
      storage,
      { webhookUrl: "  https://hooks.example/save?token=user  " },
      undefined,
      reset,
    ),
  ).resolves.toEqual({
    applied: { webhookUrl: "https://hooks.example/save?token=user" },
    rejected: [],
  });

  await expect(
    applyConfigSerialized(
      { queue: Promise.resolve() },
      storage,
      { webhookUrl: "http://hooks.example/save" },
      undefined,
      reset,
    ),
  ).resolves.toEqual({
    applied: {},
    rejected: [{ name: "webhookUrl", reason: "invalid value" }],
  });
  expect(OptionsManagement.getKeys()).toContain("webhookEnabled");
});

// The endpoint option is a list now, and it still arrives from imported
// configuration, which is untrusted for endpoints. The guard that kept a
// non-HTTPS endpoint out of storage has to hold for every line, not just a
// value that happens to be one line.
test("accepts a list of endpoints and rejects one that names an unusable line", async () => {
  const storage = { get: vi.fn(), set: vi.fn(async () => {}) };
  const reset = vi.fn(async () => {});
  const apply = (webhookUrl: string) =>
    applyConfigSerialized({ queue: Promise.resolve() }, storage, { webhookUrl }, undefined, reset);

  await expect(apply("https://a.example/save\nhttps://b.example/save")).resolves.toEqual({
    applied: { webhookUrl: "https://a.example/save\nhttps://b.example/save" },
    rejected: [],
  });

  // One bad line rejects the value rather than being quietly dropped from it:
  // a stored list must never name an endpoint that will not be sent to.
  await expect(apply("https://a.example/save\nhttp://b.example/save")).resolves.toEqual({
    applied: {},
    rejected: [{ name: "webhookUrl", reason: "invalid value" }],
  });

  // Likewise a list longer than the extension will send: accepting it would
  // silently send to some of the endpoints it names and not the others.
  const tooMany = Array.from(
    { length: WEBHOOK_TARGET_LIMIT + 1 },
    (_, index) => `https://hook-${index}.example/save`,
  ).join("\n");
  await expect(apply(tooMany)).resolves.toEqual({
    applied: {},
    rejected: [{ name: "webhookUrl", reason: "invalid value" }],
  });
});
