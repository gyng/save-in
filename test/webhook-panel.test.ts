// @vitest-environment jsdom
import { setupWebhookPanel, type WebhookPanelDependencies } from "../src/options/webhook-panel.ts";

const markup = () => {
  document.body.innerHTML = `
    <input id="webhookUrl">
    <input type="checkbox" id="webhookEnabled" disabled>
    <button id="webhook-test" disabled>Send test</button>
    <input type="checkbox" id="webhookIncludePageUrl">
    <input type="checkbox" id="webhookIncludePageTitle">
    <input type="checkbox" id="webhookIncludeSelectionText">
    <pre id="webhook-payload-preview"></pre>
    <div id="webhook-status"></div>`;
};

const dependencies = (
  overrides: Partial<WebhookPanelDependencies> = {},
): WebhookPanelDependencies => ({
  permissions: {
    getAll: vi.fn(async () => ({ data_collection: [] })),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  },
  apply: vi.fn(async () => ({})),
  post: vi.fn(async () => ({ ok: true, status: 204 })),
  message: (_key, fallback) => fallback,
  ...overrides,
});

beforeEach(markup);

test("requests Firefox data consent and atomically enables a valid endpoint", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  endpoint.value = "https://hooks.example/save";
  endpoint.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));

  enabled.checked = true;
  enabled.dispatchEvent(new Event("change"));

  await vi.waitFor(() =>
    expect(ports.permissions?.request).toHaveBeenCalledWith({
      data_collection: ["browsingActivity", "websiteActivity"],
    }),
  );
  await vi.waitFor(() =>
    expect(ports.apply).toHaveBeenCalledWith({
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/save",
    }),
  );
  expect(enabled.checked).toBe(true);
});

test("does not enable delivery when Firefox consent is declined", async () => {
  const ports = dependencies({
    permissions: {
      getAll: vi.fn(async () => ({ data_collection: [] })),
      request: vi.fn(async () => false),
    },
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  endpoint.value = "https://hooks.example/save";
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));

  enabled.checked = true;
  enabled.dispatchEvent(new Event("change"));

  await vi.waitFor(() => expect(enabled.checked).toBe(false));
  expect(ports.apply).not.toHaveBeenCalledWith(expect.objectContaining({ webhookEnabled: true }));
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookPermissionDenied");
});

test("surfaces a revoked Firefox permission for a stored enabled webhook", async () => {
  const ports = dependencies({ message: (key) => key });
  document.querySelector<HTMLInputElement>("#webhookEnabled")!.checked = true;
  setupWebhookPanel(ports);

  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookPermissionMissing"),
  );
});

test("fails closed when browser data permission cannot be checked", async () => {
  const ports = dependencies({
    permissions: {
      getAll: vi.fn(async () => Promise.reject(new Error("unavailable"))),
      request: vi.fn(async () => true),
    },
    message: (key) => key,
  });
  setupWebhookPanel(ports);

  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe(
      "webhookPermissionCheckFailed",
    ),
  );
  expect(document.querySelector<HTMLInputElement>("#webhookEnabled")?.disabled).toBe(true);
});

test("requests website-content access before adding page content", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  const title = document.querySelector<HTMLInputElement>("#webhookIncludePageTitle")!;
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));
  enabled.checked = true;

  title.checked = true;
  title.dispatchEvent(new Event("change"));

  await vi.waitFor(() =>
    expect(ports.permissions?.request).toHaveBeenCalledWith({
      data_collection: ["browsingActivity", "websiteActivity", "websiteContent"],
    }),
  );
  await vi.waitFor(() =>
    expect(ports.apply).toHaveBeenCalledWith({ webhookIncludePageTitle: true }),
  );
  expect(document.querySelector("#webhook-payload-preview")?.textContent).toContain("pageTitle");
});

test("sends a privacy-minimal test and reports endpoint rejection", async () => {
  const ports = dependencies({
    post: vi.fn(async () => ({ ok: false, status: 403 })),
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const button = document.querySelector<HTMLButtonElement>("#webhook-test")!;
  endpoint.value = "https://hooks.example/test";
  endpoint.dispatchEvent(new Event("input"));

  expect(button.disabled).toBe(false);
  button.click();

  await vi.waitFor(() => expect(ports.post).toHaveBeenCalledWith("https://hooks.example/test"));
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookTestRejected");
});
