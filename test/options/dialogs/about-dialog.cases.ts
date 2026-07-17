// Cases imported by about-dialog.test.ts to share one jsdom environment.
import { setupAboutDialog } from "../../../src/options/dialogs/about-dialog.ts";
import { BROWSERS, setCurrentBrowser } from "../../../src/platform/chrome-detector.ts";
import { webExtensionApi } from "../../../src/platform/web-extension-api.ts";

afterEach(() => setCurrentBrowser(BROWSERS.UNKNOWN));

test("opens and closes the About dialog", () => {
  document.body.innerHTML = `
    <details open>
      <summary>Help & resources</summary>
      <button id="about-open">About</button>
    </details>
    <dialog id="about-dialog"><button class="about-close">Close</button></dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });
  setupAboutDialog();
  document.querySelector<HTMLButtonElement>("#about-open")!.click();
  expect(dialog.showModal).toHaveBeenCalledOnce();
  const close = document.querySelector<HTMLButtonElement>(".about-close")!;
  close.focus();
  close.click();
  expect(dialog.close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(document.querySelector("summary"));
});

test("returns focus to a standalone opener and tolerates its removal", () => {
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog"><button class="about-close">Close</button></dialog>`;
  const open = document.querySelector<HTMLButtonElement>("#about-open")!;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  setupAboutDialog();

  open.click();
  open.remove();
  expect(() => dialog.dispatchEvent(new Event("close"))).not.toThrow();
});

test("opens the welcome guide from About", () => {
  document.body.innerHTML = `
    <span id="lastSavedAt">Saved</span>
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <a id="about-welcome" href="#welcome-dialog">Show welcome guide</a>
    </dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("#about-dialog")!;
  dialog.close = vi.fn(() => dialog.removeAttribute("open"));
  setupAboutDialog();

  document.querySelector<HTMLAnchorElement>("#about-welcome")!.click();

  expect(dialog.close).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLDialogElement>("#welcome-dialog")?.open).toBe(true);
  expect(document.querySelector("#lastSavedAt")?.textContent).toBe("Saved");
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

test("closes from the backdrop and celebrates every fifth mascot click", () => {
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <button class="about-mascot-button">Mascot</button>
    </dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.close = vi.fn();
  setupAboutDialog();
  const mascot = document.querySelector<HTMLButtonElement>(".about-mascot-button")!;

  for (let index = 0; index < 4; index += 1) mascot.click();
  expect(mascot.classList.contains("is-celebrating")).toBe(false);
  mascot.click();
  expect(mascot.classList.contains("is-celebrating")).toBe(true);
  dialog.dispatchEvent(new Event("close"));
  expect(mascot.classList.contains("is-celebrating")).toBe(false);
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog.close).toHaveBeenCalledOnce();
});

test("tolerates partial markup and reports unavailable version metadata", () => {
  document.body.innerHTML = '<button id="about-open">About</button>';
  expect(setupAboutDialog()).toBeUndefined();

  vi.spyOn(webExtensionApi.runtime, "getManifest").mockReturnValue({ version: "" } as any);
  vi.mocked(webExtensionApi.i18n.getMessage).mockImplementation((key) =>
    key === "diagnosticsUnavailable" ? "Nicht verfügbar" : "",
  );
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <span id="about-version"></span>
    </dialog>`;
  setCurrentBrowser(BROWSERS.CHROME);
  setupAboutDialog();
  expect(document.querySelector("#about-version")?.textContent).toBe("Nicht verfügbar");

  vi.mocked(webExtensionApi.i18n.getMessage).mockReturnValue("");
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <span id="about-version"></span>
    </dialog>`;
  setupAboutDialog();
  expect(document.querySelector("#about-version")?.textContent).toBe("Unavailable");
});
