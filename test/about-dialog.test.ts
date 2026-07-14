// @vitest-environment jsdom
import { setupAboutDialog } from "../src/options/about-dialog.ts";
import { BROWSERS, setCurrentBrowser } from "../src/platform/chrome-detector.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";

afterEach(() => setCurrentBrowser(BROWSERS.UNKNOWN));

test("opens and closes the About dialog", () => {
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog"><button class="about-close">Close</button></dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => dialog.removeAttribute("open"));
  setupAboutDialog();
  document.querySelector<HTMLButtonElement>("#about-open")!.click();
  expect(dialog.showModal).toHaveBeenCalledOnce();
  document.querySelector<HTMLButtonElement>(".about-close")!.click();
  expect(dialog.close).toHaveBeenCalledOnce();
});

test("shows the runtime manifest version without generated checkout metadata", () => {
  vi.spyOn(webExtensionApi.runtime, "getManifest").mockReturnValue({ version: "4.0.0" } as any);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <span id="about-version"></span>
    </dialog>`;

  setupAboutDialog();
  expect(document.querySelector("#about-version")?.textContent).toBe("v4.0.0");
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test.each([
  [BROWSERS.FIREFOX, false, true],
  [BROWSERS.CHROME, true, false],
  [BROWSERS.UNKNOWN, true, true],
])("shows only the store for %s", (browser, firefoxHidden, chromeHidden) => {
  setCurrentBrowser(browser);
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <a id="about-store-firefox" data-about-store hidden>Firefox</a>
      <a id="about-store-chrome" data-about-store hidden>Chrome</a>
    </dialog>`;

  setupAboutDialog();

  expect(document.querySelector<HTMLAnchorElement>("#about-store-firefox")!.hidden).toBe(
    firefoxHidden,
  );
  expect(document.querySelector<HTMLAnchorElement>("#about-store-chrome")!.hidden).toBe(
    chromeHidden,
  );
});
