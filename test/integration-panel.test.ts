import { setupIntegrationPanel } from "../src/options/integration-panel.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../src/shared/constants.ts";

test("renders build identity and the live external API contract", async () => {
  const originalId = webExtensionApi.runtime.id;
  Object.defineProperty(webExtensionApi.runtime, "id", {
    configurable: true,
    value: "save-in@test",
  });
  document.body.innerHTML = `
    <a id="version-label"></a>
    <span id="ext-id"></span><pre id="api-snippet"></pre>
    <span id="api-version"></span><span id="api-capabilities"></span>`;
  vi.spyOn(webExtensionApi.runtime, "getManifest").mockReturnValue({ version: "4.0.0" } as any);
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue({
    type: MESSAGE_TYPES.PONG,
    body: { version: 1, capabilities: ["download", "active_tab"] },
  });
  setupIntegrationPanel();

  expect(document.querySelector("#version-label")?.textContent).toBe("v4.0.0");
  expect(document.querySelector("#ext-id")?.textContent).toBe(webExtensionApi.runtime.id);
  expect(document.querySelector("#api-snippet")?.textContent).toContain('type: "DOWNLOAD"');
  expect(document.querySelector("#api-snippet")?.textContent).toContain("caller's own runtime.id");
  await vi.waitFor(() => expect(document.querySelector("#api-version")?.textContent).toBe("v1"));
  expect(document.querySelector("#api-capabilities")?.textContent).toBe("download, active_tab");

  Object.defineProperty(webExtensionApi.runtime, "id", {
    configurable: true,
    value: originalId,
  });
});

test("lists rejected callers and adds an approved caller to the allowlist", async () => {
  document.body.innerHTML = `
    <a id="version-label"></a><span id="ext-id"></span><pre id="api-snippet"></pre>
    <span id="api-version"></span><span id="api-capabilities"></span>
    <textarea id="externalDownloadAllowlist">existing-extension</textarea>
    <section id="external-download-rejections" hidden>
      <div id="external-download-rejection-list"></div>
    </section>`;
  vi.spyOn(webExtensionApi.runtime, "getManifest").mockReturnValue({ version: "4.0.0" } as any);
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockImplementation(async (message: any) => {
      if (message.type === MESSAGE_TYPES.PING) {
        return { type: MESSAGE_TYPES.PONG, body: { version: 1, capabilities: [] } };
      }
      if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET) {
        return {
          type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
          body: {
            rejections: [
              {
                senderId: "blocked-extension",
                attempts: 3,
                lastRejectedAt: "2026-07-13T10:00:00.000Z",
                requestType: "url",
              },
            ],
          },
        };
      }
      if (message.type === MESSAGE_TYPES.APPLY_CONFIG) {
        return {
          type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
          body: {
            version: 1,
            applied: { externalDownloadAllowlist: message.body.config.externalDownloadAllowlist },
            rejected: [],
          },
        };
      }
      if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR) {
        return { type: MESSAGE_TYPES.OK };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });

  setupIntegrationPanel();
  document.dispatchEvent(new Event("options-restored"));
  await vi.waitFor(() =>
    expect(document.querySelector("[data-rejected-sender-id='blocked-extension']")).not.toBeNull(),
  );
  const row = document.querySelector<HTMLElement>("[data-rejected-sender-id='blocked-extension']")!;
  expect(row.textContent).toContain("3 blocked attempts");
  expect(row.querySelector("button")?.textContent).toBe("Approve");

  row.querySelector<HTMLButtonElement>("button")?.click();

  await vi.waitFor(() => expect(row.isConnected).toBe(false));
  expect(document.querySelector<HTMLTextAreaElement>("#externalDownloadAllowlist")?.value).toBe(
    "existing-extension\nblocked-extension",
  );
  expect(sendMessage).toHaveBeenCalledWith({
    type: MESSAGE_TYPES.APPLY_CONFIG,
    body: {
      config: { externalDownloadAllowlist: "existing-extension\nblocked-extension" },
    },
  });
  expect(sendMessage).toHaveBeenCalledWith({
    type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
    body: { senderId: "blocked-extension" },
  });
});

test("manages approved extension IDs without exposing the raw editor", async () => {
  document.body.innerHTML = `
    <a id="version-label"></a><span id="ext-id"></span><pre id="api-snippet"></pre>
    <span id="api-version"></span><span id="api-capabilities"></span>
    <input id="external-extension-id-draft" />
    <button id="external-extension-id-add" type="button">Allow</button>
    <span id="external-approved-count"></span>
    <div id="external-approved-list"></div>
    <div id="external-approved-empty"></div>
    <div id="external-approved-status"></div>
    <textarea id="externalDownloadAllowlist">existing-extension\nsecond-extension</textarea>
    <section id="external-download-rejections" hidden>
      <div id="external-download-rejection-list"></div>
    </section>`;
  vi.spyOn(webExtensionApi.runtime, "getManifest").mockReturnValue({ version: "4.0.0" } as any);
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) => {
    if (message.type === MESSAGE_TYPES.PING) {
      return { type: MESSAGE_TYPES.PONG, body: { version: 1, capabilities: [] } };
    }
    if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET) {
      return {
        type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
        body: { rejections: [] },
      };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  });

  setupIntegrationPanel();
  document.dispatchEvent(new Event("options-restored"));

  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-approved-sender-id]")).toHaveLength(2),
  );
  expect(document.querySelector("#external-approved-count")?.textContent).toBe("2 approved");

  const draft = document.querySelector<HTMLInputElement>("#external-extension-id-draft")!;
  draft.value = "new-extension";
  draft.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>("#external-extension-id-add")?.click();

  expect(document.querySelector<HTMLTextAreaElement>("#externalDownloadAllowlist")?.value).toBe(
    "existing-extension\nsecond-extension\nnew-extension",
  );
  expect(document.querySelectorAll("[data-approved-sender-id]")).toHaveLength(3);

  document
    .querySelector<HTMLElement>("[data-approved-sender-id='existing-extension']")
    ?.querySelector<HTMLButtonElement>("button")
    ?.click();

  expect(document.querySelector<HTMLTextAreaElement>("#externalDownloadAllowlist")?.value).toBe(
    "second-extension\nnew-extension",
  );
  expect(document.querySelector("#external-approved-status")?.textContent).toContain(
    "Removed existing-extension",
  );
});
