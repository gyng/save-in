// Cases imported by about-dialog.test.ts to share one jsdom environment.
import { setupAboutDialog } from "../../../src/options/dialogs/about-dialog.ts";

test("closes the Help and resources dropdown before opening About", () => {
  document.body.innerHTML = `
    <details open>
      <summary>Help and resources</summary>
      <button id="about-open">About</button>
    </details>
    <dialog id="about-dialog"><button class="about-close">Close</button></dialog>`;
  const details = document.querySelector<HTMLDetailsElement>("details")!;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn();

  setupAboutDialog();
  document.querySelector<HTMLButtonElement>("#about-open")!.click();

  expect(details.open).toBe(false);
  expect(dialog.showModal).toHaveBeenCalledOnce();
});
