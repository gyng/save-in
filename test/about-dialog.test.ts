// @vitest-environment jsdom
import { setupAboutDialog } from "../src/options/about-dialog.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";

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

test("five mascot clicks celebrate until the dialog closes", () => {
  document.body.innerHTML = `
    <button id="about-open">About</button>
    <dialog id="about-dialog">
      <button class="about-close">Close</button>
      <button class="about-mascot-button"></button>
    </dialog>`;
  setupAboutDialog();
  const mascot = document.querySelector<HTMLButtonElement>(".about-mascot-button")!;
  for (let i = 0; i < 4; i += 1) mascot.click();
  expect(mascot.classList).not.toContain("is-celebrating");
  mascot.click();
  expect(mascot.classList).toContain("is-celebrating");
  expect(document.body.textContent).not.toContain("Lucky cat power activated");
  document.querySelector("#about-dialog")!.dispatchEvent(new Event("close"));
  expect(mascot.classList).not.toContain("is-celebrating");
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
