import { setupIntegrationPanel } from "../src/options/integration-panel.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";

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
    body: { version: 1, capabilities: ["download", "active_tab"] },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ commit: "abc1234" }) })),
  );

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
  vi.unstubAllGlobals();
});
