import { applyConfigSerialized } from "../src/background/config-apply.ts";
import { OPTION_DEFAULTS } from "../src/config/option-defaults.ts";
import { OptionsManagement } from "../src/config/option.ts";

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
