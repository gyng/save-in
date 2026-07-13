import { webExtensionApi } from "../platform/web-extension-api.ts";

const renderVersionLabel = () => {
  const element = document.querySelector<HTMLAnchorElement>("#version-label");
  if (!element) return;

  const version = webExtensionApi.runtime.getManifest().version;
  element.textContent = `v${version}`;
  element.title = `save-in v${version} — view releases`;

  fetch("version.json")
    .then((response) => response.json())
    .then(({ commit }) => {
      element.title = `save-in v${version} (${commit}) — view releases`;
    })
    .catch(() => {});
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

export const setupIntegrationPanel = () => {
  renderVersionLabel();
  renderExternalApi();
};
