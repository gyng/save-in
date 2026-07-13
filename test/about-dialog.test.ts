import { setupAboutDialog } from "../src/options/about-dialog.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

test("About explains privacy and every requested permission", () => {
  const html = readFileSync(resolve("src/options/options.html"), "utf8");
  const document = new DOMParser().parseFromString(html, "text/html");
  const about = document.querySelector("#about-dialog")!;
  expect(about.querySelector(".about-mascot")?.getAttribute("src")).toContain("mascot.webp");
  expect(about.querySelector("#about-version")).not.toBeNull();
  expect(about.querySelector("#about-commit")).toBeNull();
  expect(about.querySelector("#about-build-date")).toBeNull();
  expect(about.textContent).toContain("no analytics");
  for (const permission of [
    "Context menus",
    "Downloads",
    "Notifications",
    "Storage",
    "Offscreen",
    "Website access",
  ]) {
    expect(about.textContent).toContain(permission);
  }
  expect(about.querySelector('a[href="../../PRIVACY.md"]')).not.toBeNull();
});

test("party cat uses continuous easing instead of stepped frames", () => {
  const css = readFileSync(resolve("src/options/style.css"), "utf8");
  const celebration = css.match(
    /\.about-mascot-button\.is-celebrating \.about-mascot\s*\{([^}]*)\}/,
  )?.[1];
  expect(celebration).toContain("ease-in-out");
  expect(celebration).not.toContain("steps(");
  expect(css).toContain("translate3d");
});
