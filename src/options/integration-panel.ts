import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import type { ExternalDownloadRejection } from "../shared/external-download-rejection-types.ts";
import { splitLines } from "../shared/util.ts";

const renderVersionLabel = () => {
  const element = document.querySelector<HTMLAnchorElement>("#version-label");
  if (!element) return;

  const version = webExtensionApi.runtime.getManifest().version;
  element.textContent = `v${version}`;
  element.title = `save-in v${version} — view releases`;
};

const renderExternalApi = () => {
  const idElement = document.querySelector("#ext-id");
  if (!idElement) return;

  const id = webExtensionApi.runtime.id;
  idElement.textContent = id;

  const snippet = document.querySelector("#api-snippet");
  if (snippet) {
    snippet.textContent = [
      `const ID = "${id}";`,
      `const pong = await webExtensionApi.runtime.sendMessage(ID, { type: "PING" });`,
      `// pong.body -> { version, capabilities }`,
      `// Before DOWNLOAD, add the caller's own runtime.id to Save In's allowlist.`,
      ``,
      `const res = await webExtensionApi.runtime.sendMessage(ID, {`,
      `  type: "DOWNLOAD",`,
      `  body: {`,
      `    url: "https://example.com/pic.jpg",`,
      `    info: { pageUrl: location.href, srcUrl: "https://example.com/pic.jpg" },`,
      `  },`,
      `});`,
      `// res.body -> { status: "OK", version, url } | { status: "ERROR", error, message }`,
    ].join("\n");
  }

  const versionElement = document.querySelector("#api-version");
  const capabilitiesElement = document.querySelector("#api-capabilities");
  webExtensionApi.runtime
    .sendMessage({ type: "PING" })
    .then((pong) => {
      const body = (pong && pong.body) || {};
      if (versionElement) {
        versionElement.textContent = body.version != null ? `v${body.version}` : "unknown";
      }
      if (capabilitiesElement) {
        capabilitiesElement.textContent = (body.capabilities || []).join(", ") || "—";
      }
    })
    .catch(() => {
      if (versionElement) versionElement.textContent = "unavailable";
      if (capabilitiesElement) capabilitiesElement.textContent = "—";
    });
};

let approvalQueue: Promise<unknown> = Promise.resolve();

const rejectionAttemptLabel = (attempts: number): string =>
  `${attempts} blocked ${attempts === 1 ? "attempt" : "attempts"}`;

const renderRejectedCaller = (
  rejection: ExternalDownloadRejection,
  list: Element,
  panel: HTMLElement,
  status: HTMLElement | null,
) => {
  const row = document.createElement("div");
  row.className = "external-download-rejection";
  row.dataset.rejectedSenderId = rejection.senderId;

  const details = document.createElement("div");
  details.className = "external-download-rejection-details";
  const senderId = document.createElement("code");
  senderId.textContent = rejection.senderId;
  const summary = document.createElement("div");
  summary.className = "caption";
  const requestLabel =
    rejection.requestType === "activeTab"
      ? "active-tab request"
      : rejection.requestType === "url"
        ? "URL request"
        : "download request";
  summary.textContent = `${rejectionAttemptLabel(rejection.attempts)} · ${requestLabel} · ${new Date(
    rejection.lastRejectedAt,
  ).toLocaleString()}`;
  details.append(senderId, summary);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "button external-download-rejection-add";
  add.textContent = "Add";
  add.addEventListener("click", () => {
    add.disabled = true;
    add.textContent = "Adding…";
    if (status) status.textContent = "";
    approvalQueue = approvalQueue
      .catch(() => {})
      .then(async () => {
        const allowlist = document.querySelector<HTMLTextAreaElement>("#externalDownloadAllowlist");
        if (!allowlist) throw new Error("The allowlist field is unavailable");
        const ids = splitLines(allowlist.value);
        if (!ids.includes(rejection.senderId)) ids.push(rejection.senderId);
        const nextAllowlist = ids.join("\n");
        const applied = (await webExtensionApi.runtime.sendMessage({
          type: MESSAGE_TYPES.APPLY_CONFIG,
          body: { config: { externalDownloadAllowlist: nextAllowlist } },
        })) as {
          type?: string;
          body?: { applied?: Record<string, unknown>; rejected?: unknown[] };
        };
        if (
          applied.type !== MESSAGE_TYPES.APPLY_CONFIG_RESULT ||
          !applied.body ||
          !Array.isArray(applied.body.rejected) ||
          applied.body.rejected.length > 0 ||
          applied.body.applied?.externalDownloadAllowlist !== nextAllowlist
        ) {
          throw new Error("Save In did not accept the allowlist change");
        }
        const cleared = (await webExtensionApi.runtime.sendMessage({
          type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
          body: { senderId: rejection.senderId },
        })) as { type?: string };
        if (cleared.type !== MESSAGE_TYPES.OK) {
          throw new Error("Save In could not clear the rejected request");
        }
        allowlist.value = nextAllowlist;
        // Keep the textarea's debounced autosave as the final writer if the
        // user was already editing while this approval request was in flight.
        allowlist.dispatchEvent(new Event("input", { bubbles: true }));
        row.remove();
        panel.hidden = !list.children.length;
      })
      .catch((error) => {
        add.disabled = false;
        add.textContent = "Add";
        if (status) status.textContent = `Could not add ${rejection.senderId}: ${String(error)}`;
      });
  });

  row.append(details, add);
  list.appendChild(row);
};

const renderExternalDownloadRejections = async () => {
  const panel = document.querySelector<HTMLElement>("#external-download-rejections");
  const list = document.querySelector("#external-download-rejection-list");
  const status = document.querySelector<HTMLElement>("#external-download-rejection-status");
  if (!panel || !list) return;

  try {
    const response = (await webExtensionApi.runtime.sendMessage({
      type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
    })) as { type?: string; body?: { rejections?: ExternalDownloadRejection[] } };
    if (
      response.type !== MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET ||
      !Array.isArray(response.body?.rejections)
    ) {
      throw new Error("Invalid rejected-download response");
    }
    list.textContent = "";
    response.body.rejections.forEach((rejection) =>
      renderRejectedCaller(rejection, list, panel, status),
    );
    panel.hidden = response.body.rejections.length === 0;
  } catch (error) {
    panel.hidden = false;
    if (status) status.textContent = `Could not load rejected requests: ${String(error)}`;
  }
};

export const setupIntegrationPanel = () => {
  renderVersionLabel();
  renderExternalApi();
  // Approval composes with the restored allowlist value. Rendering before the
  // asynchronous options restore could replace an existing legacy allowlist.
  document.addEventListener("options-restored", () => void renderExternalDownloadRejections(), {
    once: true,
  });
};
