// @vitest-environment jsdom
import {
  createDataCollectionPermissionsApi,
  setupWebhookPanel,
  type WebhookPanelDependencies,
} from "../../../src/options/integrations/webhook-panel.ts";
import { webExtensionApi } from "../../../src/platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../../src/shared/constants.ts";

const markup = () => {
  document.body.innerHTML = `
    <textarea id="webhookUrl"></textarea>
    <input type="checkbox" id="webhookAllowInsecure">
    <input type="checkbox" id="webhookEnabled" disabled>
    <span id="webhook-state-badge"></span>
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("normalizes the browser data-permission boundary without type assertions", async () => {
  const host = {
    marker: "permissions",
    getAll: vi.fn(function (this: { marker: string }) {
      expect(this.marker).toBe("permissions");
      return Promise.resolve({
        data_collection: ["browsingActivity", "unknown", 17, "websiteContent"],
      });
    }),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => "not-a-boolean"),
  };
  const permissions = createDataCollectionPermissionsApi(host);

  expect(await permissions?.getAll()).toEqual({
    data_collection: ["browsingActivity", "websiteContent"],
  });
  await expect(permissions?.request({ data_collection: ["browsingActivity"] })).resolves.toBe(true);
  await expect(permissions?.remove?.({ data_collection: ["websiteContent"] })).resolves.toBe(false);
  expect(createDataCollectionPermissionsApi(null)).toBeUndefined();
  expect(createDataCollectionPermissionsApi({ getAll: () => ({}) })).toBeUndefined();

  const callable = Object.assign(() => undefined, {
    getAll: vi.fn(async () => null),
    request: vi.fn(async () => false),
  });
  const callablePermissions = createDataCollectionPermissionsApi(callable);
  await expect(callablePermissions?.getAll()).resolves.toEqual({});
  expect(callablePermissions?.remove).toBeUndefined();
});

test("runs without the optional enabled-state badge", async () => {
  document.querySelector("#webhook-state-badge")?.remove();

  expect(() => setupWebhookPanel(dependencies())).not.toThrow();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>("#webhookEnabled")?.disabled).toBe(false),
  );
});

test("returns when the complete webhook control set is unavailable", () => {
  document.body.innerHTML = "";
  expect(() => setupWebhookPanel(dependencies())).not.toThrow();
});

test("wires the default save, delivery, and localization dependencies", async () => {
  vi.mocked(browser.i18n.getMessage).mockReturnValue("");
  vi.mocked(webExtensionApi.runtime.sendMessage).mockResolvedValue({
    type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
    body: { version: 1, applied: {}, rejected: [] },
  });
  const fetcher = vi.fn(async () => ({ ok: true, status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  setupWebhookPanel();
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  endpoint.value = "https://hooks.example/default";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await vi.waitFor(() => expect(webExtensionApi.runtime.sendMessage).toHaveBeenCalled());

  document.querySelector<HTMLButtonElement>("#webhook-test")!.click();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("Test delivered."),
  );
  expect(document.querySelector("#webhook-status")?.classList.contains("feedback-success")).toBe(
    true,
  );
});

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
  expect(document.querySelector("#webhook-state-badge")?.textContent).toBe("On");
  expect(document.querySelector("#webhook-state-badge")?.getAttribute("data-state")).toBe("on");
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

test("does not re-request data permissions that are already granted", async () => {
  const ports = dependencies({
    permissions: {
      getAll: vi.fn(async () => ({
        data_collection: ["browsingActivity", "websiteActivity"],
      })),
      request: vi.fn(async () => true),
    },
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  endpoint.value = "https://hooks.example/save";
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));
  enabled.checked = true;
  enabled.dispatchEvent(new Event("change"));

  await vi.waitFor(() =>
    expect(ports.apply).toHaveBeenCalledWith({
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/save",
    }),
  );
  expect(ports.permissions?.request).not.toHaveBeenCalled();
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

  // Every endpoint is posted and then reported together, so wait for the report
  // rather than for the request that precedes it.
  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookTestRejected"),
  );
  expect(ports.post).toHaveBeenCalledWith("https://hooks.example/test", { allowInsecure: false });
  expect(document.querySelector("#webhook-status")?.classList.contains("feedback-error")).toBe(
    true,
  );
});

test("debounces valid endpoint saves, saves blank endpoints, and rejects malformed endpoints", async () => {
  vi.useFakeTimers();
  const ports = dependencies();
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;

  endpoint.value = "https://hooks.example/first";
  endpoint.dispatchEvent(new InputEvent("input"));
  endpoint.value = "https://hooks.example/final";
  endpoint.dispatchEvent(new InputEvent("input"));
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await Promise.resolve();
  expect(ports.apply).toHaveBeenCalledWith({ webhookUrl: "https://hooks.example/final" });

  vi.mocked(ports.apply).mockClear();
  endpoint.dispatchEvent(new InputEvent("input"));
  await vi.advanceTimersByTimeAsync(400);
  expect(ports.apply).toHaveBeenCalledWith({ webhookUrl: "https://hooks.example/final" });

  endpoint.value = "";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await vi.waitFor(() => expect(ports.apply).toHaveBeenCalledWith({ webhookUrl: "" }));

  vi.mocked(ports.apply).mockClear();
  endpoint.value = "http://insecure.example/hook";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await Promise.resolve();
  expect(endpoint.validationMessage).toContain("HTTPS");
  expect(ports.apply).not.toHaveBeenCalled();
});

test("reports endpoint-save failures", async () => {
  const ports = dependencies({
    apply: vi.fn(() => Promise.reject(new Error("storage"))),
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  endpoint.value = "https://hooks.example/save";
  endpoint.dispatchEvent(new FocusEvent("blur"));

  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookSaveFailed"),
  );
});

test("reports invalid test URLs and delivery failures", async () => {
  const ports = dependencies({
    post: vi.fn(() => Promise.reject(new Error("offline"))),
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const button = document.querySelector<HTMLButtonElement>("#webhook-test")!;
  const reportValidity = vi.spyOn(endpoint, "reportValidity").mockReturnValue(false);

  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(reportValidity).toHaveBeenCalled();
  expect(ports.post).not.toHaveBeenCalled();

  endpoint.value = "https://hooks.example/test";
  endpoint.dispatchEvent(new InputEvent("input"));
  button.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookTestFailed"),
  );
  expect(button.dataset.sending).toBeUndefined();
  expect(button.disabled).toBe(false);
});

test("enables without a data-permission API and rejects invalid endpoints", async () => {
  const ports = dependencies({ permissions: undefined });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl")!;
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));

  enabled.checked = true;
  enabled.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(enabled.checked).toBe(false));
  expect(ports.apply).not.toHaveBeenCalled();

  endpoint.value = "https://hooks.example/save";
  enabled.checked = true;
  enabled.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(ports.apply).toHaveBeenCalledWith({
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/save",
    }),
  );
});

test.each([
  [true, false],
  [false, true],
])("disables webhooks and handles permission removal %#", async (removed, rejects) => {
  const remove = rejects
    ? vi.fn(() => Promise.reject(new Error("unsupported")))
    : vi.fn(async () => removed);
  const ports = dependencies({
    permissions: {
      getAll: vi.fn(async () => ({
        data_collection: ["browsingActivity", "websiteActivity", "websiteContent"],
      })),
      request: vi.fn(async () => true),
      remove,
    },
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));
  enabled.checked = false;
  enabled.dispatchEvent(new Event("change"));

  await vi.waitFor(() => expect(ports.apply).toHaveBeenCalledWith({ webhookEnabled: false }));
  await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookDisabledSaved");
});

test("restores the toggle after an enable save fails", async () => {
  const ports = dependencies({
    apply: vi.fn(() => Promise.reject(new Error("storage"))),
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
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookSaveFailed");
  expect(enabled.disabled).toBe(false);
});

test("reverts denied and failed field changes", async () => {
  const denied = dependencies({
    permissions: {
      getAll: vi.fn(async () => ({ data_collection: [] })),
      request: vi.fn(async () => false),
    },
    message: (key) => key,
  });
  setupWebhookPanel(denied);
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled")!;
  const title = document.querySelector<HTMLInputElement>("#webhookIncludePageTitle")!;
  await vi.waitFor(() => expect(enabled.disabled).toBe(false));
  enabled.checked = true;
  title.checked = true;
  title.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(title.checked).toBe(false));
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookPermissionDenied");

  markup();
  const failed = dependencies({
    apply: vi.fn(() => Promise.reject(new Error("storage"))),
    message: (key) => key,
  });
  setupWebhookPanel(failed);
  const selection = document.querySelector<HTMLInputElement>("#webhookIncludeSelectionText")!;
  selection.checked = false;
  selection.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(selection.checked).toBe(true));
  expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookSaveFailed");
  expect(selection.disabled).toBe(false);
});

test("refreshes preview, validation, and permission state after options restore", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const title = document.querySelector<HTMLInputElement>("#webhookIncludePageTitle")!;
  title.checked = true;
  document.dispatchEvent(new Event("options-restored"));
  expect(document.querySelector("#webhook-payload-preview")?.textContent).toContain("pageTitle");
});

test("saves a list of endpoints, tests every one, and names a bad line", async () => {
  const ports = dependencies({
    post: vi.fn(async () => ({ ok: true, status: 200 })),
    message: (key) => key,
  });
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl")!;
  const button = document.querySelector<HTMLButtonElement>("#webhook-test")!;

  endpoint.value = "https://a.example/save\nhttps://b.example/save";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await vi.waitFor(() =>
    expect(ports.apply).toHaveBeenCalledWith({
      webhookUrl: "https://a.example/save\nhttps://b.example/save",
    }),
  );

  button.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#webhook-status")?.textContent).toBe("webhookTestDelivered"),
  );
  expect(vi.mocked(ports.post).mock.calls.map((call) => call[0])).toEqual([
    "https://a.example/save",
    "https://b.example/save",
  ]);

  // A bad line names itself, and nothing is saved while it is there.
  vi.mocked(ports.apply).mockClear();
  endpoint.value = "https://a.example/save\nhttp://b.example/save";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await Promise.resolve();
  expect(endpoint.validationMessage).toContain("Line 2");
  expect(endpoint.validationMessage).toContain("HTTPS");
  expect(ports.apply).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
});

test("takes an http endpoint only once the checkbox says so, and applies both in one write", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl")!;
  const allowInsecure = document.querySelector<HTMLInputElement>("#webhookAllowInsecure")!;
  const button = document.querySelector<HTMLButtonElement>("#webhook-test")!;

  endpoint.value = "http://hooks.example/save";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await Promise.resolve();
  expect(ports.apply).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);

  // Ticking the box has to carry the list with it: the write boundary reads the
  // flag from the same config, so the line is refused if the flag arrives alone.
  allowInsecure.checked = true;
  allowInsecure.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(ports.apply).toHaveBeenCalled());
  expect(ports.apply).toHaveBeenCalledWith({
    webhookAllowInsecure: true,
    webhookUrl: "http://hooks.example/save",
  });
  expect(button.disabled).toBe(false);
});

test("stops trusting a stored http endpoint the moment the checkbox is cleared", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl")!;
  const allowInsecure = document.querySelector<HTMLInputElement>("#webhookAllowInsecure")!;
  const button = document.querySelector<HTMLButtonElement>("#webhook-test")!;

  allowInsecure.checked = true;
  allowInsecure.dispatchEvent(new Event("change"));
  endpoint.value = "http://hooks.example/save";
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await vi.waitFor(() => expect(button.disabled).toBe(false));

  vi.mocked(ports.apply).mockClear();
  allowInsecure.checked = false;
  allowInsecure.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(ports.apply).toHaveBeenCalled());

  // Tightening the setting writes only the flag. The line stays for the user to
  // fix, and says why it is no longer one that would be sent to.
  expect(ports.apply).toHaveBeenCalledWith({ webhookAllowInsecure: false });
  expect(button.disabled).toBe(true);
  endpoint.dispatchEvent(new FocusEvent("blur"));
  await Promise.resolve();
  expect(endpoint.validationMessage).toContain("Line 1");
});

test("previews the request it would make, not just the body", async () => {
  const ports = dependencies();
  setupWebhookPanel(ports);
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl")!;
  const preview = document.querySelector<HTMLElement>("#webhook-payload-preview")!;

  // With nothing usable to send to, the request line still has to name a target.
  expect(preview.textContent).toContain("POST https://hooks.example.com/save");
  expect(preview.textContent).toContain("Content-Type: application/json");
  expect(preview.textContent).toContain('"event": "save"');

  endpoint.value = "https://real.example/save?token=abc";
  endpoint.dispatchEvent(new Event("input"));
  expect(preview.textContent).toContain("POST https://real.example/save?token=abc");
});
