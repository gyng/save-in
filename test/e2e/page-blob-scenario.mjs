import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { closeLocal, decodeString, listenLocal, requireValue } from "./helpers.mjs";

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluatePage: (target: string, expression: string) => Promise<unknown>,
 * }} adapters
 */
export const runPageBlobScenario = async ({ control, evaluatePage }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9FEAAAAASUVORK5CYII=",
    "base64",
  );
  // Trailing bytes keep the PNG displayable while exercising several port chunks.
  const content = Buffer.concat([png, Buffer.alloc(150_000, 7)]);
  const hash = createHash("sha256").update(content).digest("hex");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<img id="image"><script>
      document.querySelector('#image').src = URL.createObjectURL(new Blob([
        Uint8Array.from(atob('${content.toString("base64")}'), c => c.charCodeAt(0))
      ], {type: 'image/png'}));
    </script>`);
  });
  const port = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${port}/page-blob`;
  let tabId;
  try {
    await control.background.applyConfig({
      paths: "e2e/page-blob",
      filenamePatterns: "mime: ^image/png$\ninto: :sha256full:-:filename:",
      prompt: false,
      promptIfNoExtension: false,
      promptOnFailure: false,
      setRefererHeader: false,
      fetchViaFetch: false,
    });
    const tab = await control.tabs.create({ url: pageUrl, active: true });
    tabId = requireValue(tab.id, "Page blob fixture tab missing");
    await control.tabs.wait({ id: tabId, status: "complete" });
    await control.tabs.waitContentReady(tabId);
    const url = decodeString(await evaluatePage(pageUrl, "document.querySelector('#image').src"));
    await control.background.clickContextMenu({
      info: { menuItemId: "save-in-0", frameId: 0, pageUrl, srcUrl: url, mediaType: "image" },
      tab: { id: tabId, url: pageUrl, title: "Page blob" },
    });
    const rows = await control.downloads.wait({
      filenameIncludes: `${hash}-`,
      minimumComplete: 1,
      timeoutMs: 10000,
    });
    const saved = requireValue(
      rows.find((row) => row.state === "complete"),
      "Page blob download missing",
    );
    expect(saved.filename.endsWith(`${hash}-${url.slice(url.lastIndexOf("/") + 1)}.png`)).toBe(
      true,
    );
    expect(fs.readFileSync(saved.filename)).toEqual(content);
    await control.history.wait({ url, status: "complete" });
    // Download cleanup must revoke only the extension's copy, never the image
    // still displayed by its source page.
    expect(
      await evaluatePage(
        pageUrl,
        `fetch(document.querySelector('#image').src).then(r => r.blob()).then(b => b.size)`,
      ),
    ).toBe(content.length);
  } finally {
    if (tabId !== undefined) await control.tabs.remove(tabId).catch(() => {});
    await closeLocal(server);
  }
};
