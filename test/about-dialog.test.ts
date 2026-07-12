import { setupAboutDialog } from "../src/options/about-dialog.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

test("About explains privacy and every requested permission", () => {
  const html = readFileSync(resolve("src/options/options.html"), "utf8");
  const document = new DOMParser().parseFromString(html, "text/html");
  const about = document.querySelector("#about-dialog")!;
  expect(about.querySelector(".about-mascot")?.getAttribute("src")).toContain("mascot.webp");
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
