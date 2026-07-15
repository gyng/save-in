// @vitest-environment jsdom
import { setupIntegrationPanel } from "../../src/options/integration-panel.ts";
import { initializeLocalization } from "../../src/platform/localization.ts";
import { webExtensionApi } from "../../src/platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../src/shared/constants.ts";

const dispatchRestore = () => document.dispatchEvent(new Event("options-restored"));
const capturedMessageType = (message: unknown): unknown =>
  typeof message === "object" && message !== null
    ? (message as { type?: unknown }).type
    : undefined;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(webExtensionApi.i18n.getMessage).mockReset().mockReturnValue("");
  await initializeLocalization("test-native-messages");
  document.body.innerHTML = "";
});

const rejection = (
  senderId: string,
  requestType: "activeTab" | "url" | "unknown" = "url",
  attempts = 1,
) => ({
  senderId,
  attempts,
  lastRejectedAt: "2026-07-13T10:00:00.000Z",
  requestType,
});

const rejectedCallerMarkup = (allowlist = "") => {
  document.body.innerHTML = `<textarea id="externalDownloadAllowlist">${allowlist}</textarea>
    <section id="external-download-rejections" hidden>
      <div id="external-download-rejection-list"></div>
      <div id="external-download-rejection-status"></div>
    </section>`;
};

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
});

test("localizes approved extension counts, actions, and announcements", async () => {
  document.body.innerHTML = `
    <input id="external-extension-id-draft" />
    <button id="external-extension-id-add" type="button">Zulassen</button>
    <span id="external-approved-count">Keine zugelassen</span>
    <div id="external-approved-list"></div>
    <div id="external-approved-empty"></div>
    <div id="external-approved-status"></div>
    <textarea id="externalDownloadAllowlist">alpha-extension</textarea>
    <section id="external-download-rejections" hidden>
      <div id="external-download-rejection-list"></div>
    </section>`;
  vi.mocked(webExtensionApi.i18n.getMessage).mockImplementation((key, substitutions) => {
    const value = Array.isArray(substitutions) ? substitutions[0] : substitutions;
    const messages: Record<string, string> = {
      externalApprovedCountOne: `${value} zugelassene Erweiterung`,
      externalApprovedCountMany: `${value} zugelassene Erweiterungen`,
      externalRemoveApproval: "Entfernen",
      externalRemoveApprovalFor: `Zulassung für ${value} entfernen`,
      externalApprovalRemoved: `${value} ist nicht mehr zugelassen.`,
      externalApprovalAdded: `${value} ist jetzt zugelassen.`,
    };
    return messages[key] || "";
  });
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue({
    type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
    body: { rejections: [] },
  });

  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelector("#external-approved-count")?.textContent).toBe(
      "1 zugelassene Erweiterung",
    ),
  );

  const firstRemove = document.querySelector<HTMLButtonElement>(".external-approved-remove")!;
  expect(firstRemove.textContent).toBe("Entfernen");
  expect(firstRemove.getAttribute("aria-label")).toBe("Zulassung für alpha-extension entfernen");
  firstRemove.click();
  expect(document.querySelector("#external-approved-count")?.textContent).toBe("Keine zugelassen");
  expect(document.querySelector("#external-approved-status")?.textContent).toBe(
    "alpha-extension ist nicht mehr zugelassen.",
  );

  const draft = document.querySelector<HTMLInputElement>("#external-extension-id-draft")!;
  draft.value = "beta-extension";
  draft.dispatchEvent(new InputEvent("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>("#external-extension-id-add")!.click();
  expect(document.querySelector("#external-approved-count")?.textContent).toBe(
    "1 zugelassene Erweiterung",
  );
  expect(document.querySelector("#external-approved-status")?.textContent).toBe(
    "beta-extension ist jetzt zugelassen.",
  );

  draft.value = "gamma-extension";
  draft.dispatchEvent(new InputEvent("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>("#external-extension-id-add")!.click();
  expect(document.querySelector("#external-approved-count")?.textContent).toBe(
    "2 zugelassene Erweiterungen",
  );
});

test("tolerates an integration document without optional surfaces", async () => {
  document.body.innerHTML = "";
  setupIntegrationPanel();
  dispatchRestore();
  await Promise.resolve();

  document.body.innerHTML = '<div id="external-download-rejection-list"></div>';
  setupIntegrationPanel();
  dispatchRestore();
  await Promise.resolve();
});

test.each([
  [{ body: {} }, "Unavailable", "—"],
  [{ body: { version: 2 } }, "Unavailable", "—"],
  [{ body: { version: null, capabilities: null } }, "Unknown", "—"],
])("degrades the API handshake for response %#", async (response, version, capabilities) => {
  document.body.innerHTML = `<span id="ext-id"></span>
    <span id="api-version"></span><span id="api-capabilities"></span>`;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue(response as never);
  setupIntegrationPanel();

  await vi.waitFor(() => expect(document.querySelector("#api-version")?.textContent).toBe(version));
  expect(document.querySelector("#api-capabilities")?.textContent).toBe(capabilities);
});

test("completes and contains API handshakes without result fields", async () => {
  document.body.innerHTML = '<span id="ext-id"></span>';
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockResolvedValueOnce({ body: { version: 1, capabilities: [] } } as never);
  setupIntegrationPanel();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

  document.body.innerHTML = '<span id="ext-id"></span>';
  const callsBeforeFailure = sendMessage.mock.calls.length;
  sendMessage.mockRejectedValueOnce(new Error("offline"));
  setupIntegrationPanel();
  await vi.waitFor(() => expect(sendMessage.mock.calls.length).toBeGreaterThan(callsBeforeFailure));
});

test("manages empty, duplicate, and keyboard-approved allowlist drafts", async () => {
  document.body.innerHTML = `<input id="external-extension-id-draft">
    <button id="external-extension-id-add">Allow</button>
    <span id="external-approved-count">Keine genehmigt</span>
    <div id="external-approved-list"></div><div id="external-approved-empty"></div>
    <textarea id="externalDownloadAllowlist"></textarea>
    <section id="external-download-rejections"><div id="external-download-rejection-list"></div></section>`;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue({
    type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
    body: { rejections: [] },
  });
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelector("#external-approved-count")?.textContent).toBe("Keine genehmigt"),
  );

  const draft = document.querySelector<HTMLInputElement>("#external-extension-id-draft")!;
  const add = document.querySelector<HTMLButtonElement>("#external-extension-id-add")!;
  expect(add.disabled).toBe(true);
  add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  draft.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  draft.value = "keyboard-extension";
  draft.dispatchEvent(new InputEvent("input", { bubbles: true }));
  draft.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  expect(document.querySelector("#external-approved-count")?.textContent).toBe(
    "1 approved extension",
  );

  draft.value = "keyboard-extension";
  draft.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(add.disabled).toBe(true);
  add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  document.querySelector<HTMLButtonElement>(".external-approved-remove")!.click();
  expect(document.querySelector("#external-approved-count")?.textContent).toBe("Keine genehmigt");
});

test("renders every rejected-request label and keeps the panel for remaining callers", async () => {
  vi.mocked(webExtensionApi.i18n.getMessage).mockImplementation((key, substitutions) => {
    const count = Array.isArray(substitutions) ? substitutions[0] : substitutions;
    const messages: Record<string, string> = {
      externalBlockedAttemptOne: `${count} blockierter Versuch`,
      externalBlockedAttemptMany: `${count} blockierte Versuche`,
      externalRequestActiveTab: "Anfrage für aktiven Tab",
      externalRequestUrl: "URL-Anfrage",
      externalRequestDownload: "Download-Anfrage",
      externalApprove: "Genehmigen",
    };
    return messages[key] || "";
  });
  rejectedCallerMarkup("active-caller");
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) => {
    if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET) {
      return {
        type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
        body: {
          rejections: [
            rejection("active-caller", "activeTab"),
            rejection("url-caller", "url", 2),
            rejection("other-caller", "unknown"),
          ],
        },
      };
    }
    if (message.type === MESSAGE_TYPES.APPLY_CONFIG) {
      return {
        type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
        body: {
          applied: { externalDownloadAllowlist: "active-caller" },
          rejected: [],
        },
      };
    }
    return { type: MESSAGE_TYPES.OK };
  });
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".external-download-rejection")).toHaveLength(3),
  );
  expect(document.body.textContent).toContain("1 blockierter Versuch · Anfrage für aktiven Tab");
  expect(document.body.textContent).toContain("2 blockierte Versuche · URL-Anfrage");
  expect(document.body.textContent).toContain("Download-Anfrage");

  document
    .querySelector<HTMLButtonElement>("[data-rejected-sender-id='active-caller'] button")!
    .click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-rejected-sender-id='active-caller']")).toBeNull(),
  );
  expect(document.querySelector<HTMLElement>("#external-download-rejections")!.hidden).toBe(false);
});

test.each([
  { type: "wrong" },
  { type: MESSAGE_TYPES.APPLY_CONFIG_RESULT },
  { type: MESSAGE_TYPES.APPLY_CONFIG_RESULT, body: { rejected: {}, applied: {} } },
  { type: MESSAGE_TYPES.APPLY_CONFIG_RESULT, body: { rejected: [{}], applied: {} } },
  { type: MESSAGE_TYPES.APPLY_CONFIG_RESULT, body: { rejected: [], applied: {} } },
])("rejects an unconfirmed allowlist update %#", async (applyResponse) => {
  rejectedCallerMarkup();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) => {
    if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET) {
      return {
        type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
        body: { rejections: [rejection("blocked")] },
      };
    }
    return applyResponse;
  });
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-rejected-sender-id]")).not.toBeNull(),
  );
  document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!.click();

  await vi.waitFor(() =>
    expect(document.querySelector("#external-download-rejection-status")?.textContent).toContain(
      "Could not approve blocked.",
    ),
  );
  expect(
    document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!.disabled,
  ).toBe(false);
});

test("reports missing allowlists and rejected-clear failures, then accepts a later retry", async () => {
  document.body.innerHTML = `<section id="external-download-rejections">
    <div id="external-download-rejection-list"></div>
    <div id="external-download-rejection-status"></div></section>`;
  let clearSucceeds = false;
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockImplementation(async (message: any) => {
      if (message.type === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET) {
        return {
          type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
          body: { rejections: [rejection("blocked")] },
        };
      }
      if (message.type === MESSAGE_TYPES.APPLY_CONFIG) {
        const value = message.body.config.externalDownloadAllowlist;
        return {
          type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
          body: { rejected: [], applied: { externalDownloadAllowlist: value } },
        };
      }
      return { type: clearSucceeds ? MESSAGE_TYPES.OK : "wrong" };
    });
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-rejected-sender-id]")).not.toBeNull(),
  );
  document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#external-download-rejection-status")?.textContent).toContain(
      "Could not approve blocked.",
    ),
  );
  expect(
    sendMessage.mock.calls.filter(
      ([message]) => capturedMessageType(message) === MESSAGE_TYPES.APPLY_CONFIG,
    ),
  ).toHaveLength(0);

  const allowlist = document.createElement("textarea");
  allowlist.id = "externalDownloadAllowlist";
  document.body.append(allowlist);
  document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#external-download-rejection-status")?.textContent).toContain(
      "Could not approve blocked.",
    ),
  );
  expect(
    sendMessage.mock.calls.filter(
      ([message]) =>
        capturedMessageType(message) === MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
    ),
  ).toHaveLength(1);

  clearSucceeds = true;
  document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!.click();
  await vi.waitFor(() => expect(document.querySelector("[data-rejected-sender-id]")).toBeNull());
});

test("contains approval and rejection-load failures without status outputs", async () => {
  document.body.innerHTML = `<textarea id="externalDownloadAllowlist"></textarea>
    <section id="external-download-rejections"><div id="external-download-rejection-list"></div></section>`;
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockResolvedValueOnce({
      type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
      body: { rejections: [rejection("blocked")] },
    } as never)
    .mockResolvedValueOnce({ type: "wrong" } as never);
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-rejected-sender-id]")).not.toBeNull(),
  );
  const approve = document.querySelector<HTMLButtonElement>(".external-download-rejection-add")!;
  approve.click();
  await vi.waitFor(() => expect(approve.textContent).toBe("Approve"));

  document.body.innerHTML = `<section id="external-download-rejections">
    <div id="external-download-rejection-list"></div></section>`;
  const callsBeforeLoadFailure = sendMessage.mock.calls.length;
  sendMessage.mockResolvedValueOnce({ type: "wrong" } as never);
  setupIntegrationPanel();
  dispatchRestore();
  await vi.waitFor(() =>
    expect(sendMessage.mock.calls.length).toBeGreaterThan(callsBeforeLoadFailure),
  );
});

test.each([
  () => Promise.resolve({ type: "wrong", body: { rejections: [] } }),
  () => Promise.resolve({ type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET, body: {} }),
  () => Promise.reject(new Error("offline")),
])("reports invalid rejected-caller responses", async (response) => {
  rejectedCallerMarkup();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockReturnValue(response() as never);
  setupIntegrationPanel();
  dispatchRestore();

  await vi.waitFor(() =>
    expect(document.querySelector("#external-download-rejection-status")?.textContent).toContain(
      "Could not load rejected requests",
    ),
  );
  expect(document.querySelector<HTMLElement>("#external-download-rejections")!.hidden).toBe(false);
});
