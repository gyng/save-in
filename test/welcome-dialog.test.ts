// @vitest-environment jsdom

import { WELCOME_PENDING_STORAGE_KEY, WELCOME_VERSION } from "../src/shared/storage-keys.ts";
import { setupWelcomeDialog, showWelcomeDialog } from "../src/options/welcome-dialog.ts";

const localize = (key: string): string =>
  ({
    welcomeTitle: "Welcome to Save In",
    welcomeUsingStarterSettings: "Using starter settings",
  })[key] || "";

const pageFixture = () => {
  document.body.innerHTML = `
    <span id="lastSavedAt">Never</span>
    <button id="about-open" type="button">About</button>
    <button id="paths-mode-visual" type="button">Visual</button>
    <div id="path-editor-rows"><input class="path-editor-dir" /></div>
  `;
  const dialogPrototype = HTMLDialogElement.prototype;
  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement, returnValue = "") {
      this.returnValue = returnValue;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    }),
  });
  Element.prototype.scrollIntoView = vi.fn();
};

const storageFixture = (pending: unknown = WELCOME_VERSION) => ({
  get: vi.fn(() => Promise.resolve({ [WELCOME_PENDING_STORAGE_KEY]: pending })),
  remove: vi.fn(() => Promise.resolve()),
});

beforeEach(pageFixture);
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
});

test("shows the current welcome once and accepts the working starter folders", async () => {
  const storage = storageFixture();

  await expect(setupWelcomeDialog(storage, localize)).resolves.toBe(true);
  const dialog = document.querySelector<HTMLDialogElement>("#welcome-dialog");
  expect(dialog?.open).toBe(true);
  expect(dialog?.querySelector("h1")?.textContent).toBe("Welcome to Save In");
  expect(document.querySelector("#lastSavedAt")?.textContent).toBe("Using starter settings");

  dialog?.querySelector<HTMLButtonElement>(".welcome-accept")?.click();
  expect(storage.remove).toHaveBeenCalledWith(WELCOME_PENDING_STORAGE_KEY);
  expect(document.querySelector("#welcome-dialog")).toBeNull();
});

test.each([
  ["customize", "#paths-mode-visual"],
  ["permissions", "#about-open"],
] as const)("routes the %s action into the existing options UI", async (action, target) => {
  const storage = storageFixture();
  const click = vi.spyOn(document.querySelector<HTMLButtonElement>(target)!, "click");
  await setupWelcomeDialog(storage, localize);

  document.querySelector<HTMLButtonElement>(`[data-welcome-action="${action}"]`)?.click();

  expect(click).toHaveBeenCalledOnce();
  if (action === "customize") {
    expect(document.activeElement).toBe(document.querySelector(".path-editor-dir"));
  }
});

test("dismisses from the keyboard but does not show for other or unreadable state", async () => {
  const storage = storageFixture();
  await setupWelcomeDialog(storage, localize);
  const dialog = document.querySelector<HTMLDialogElement>("#welcome-dialog")!;
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(storage.remove).toHaveBeenCalledWith(WELCOME_PENDING_STORAGE_KEY);

  const stale = storageFixture(WELCOME_VERSION + 1);
  await expect(setupWelcomeDialog(stale, localize)).resolves.toBe(false);
  expect(document.querySelector("#welcome-dialog")).toBeNull();

  const unavailable = storageFixture();
  unavailable.get.mockRejectedValueOnce(new Error("unavailable"));
  await expect(setupWelcomeDialog(unavailable, localize)).resolves.toBe(false);
});

test("can be reopened manually without changing the saved-settings status", () => {
  const storage = storageFixture(undefined);

  expect(showWelcomeDialog(storage, localize)).toBe(true);
  expect(document.querySelector<HTMLDialogElement>("#welcome-dialog")?.open).toBe(true);
  expect(document.querySelector("#lastSavedAt")?.textContent).toBe("Never");
  expect(showWelcomeDialog(storage, localize)).toBe(false);
});

test("ignores unknown actions from mutated dialog markup", () => {
  const storage = storageFixture();
  showWelcomeDialog(storage, localize);
  const action = document.querySelector<HTMLButtonElement>(".welcome-accept")!;
  action.dataset.welcomeAction = "unexpected";

  action.click();

  expect(document.querySelector("#welcome-dialog")).not.toBeNull();
  expect(storage.remove).not.toHaveBeenCalled();
});

test("uses readable fallbacks and contains missing dialog APIs and storage failures", async () => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  const storage = storageFixture();
  storage.remove.mockRejectedValueOnce(new Error("unavailable"));

  expect(showWelcomeDialog(storage, () => "", true)).toBe(true);
  const dialog = document.querySelector<HTMLDialogElement>("#welcome-dialog")!;
  expect(dialog.querySelector("h1")?.textContent).toBe("Welcome to Save In");
  expect(dialog.hasAttribute("open")).toBe(true);
  dialog
    .querySelector(".welcome-content")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.querySelector("#welcome-dialog")).toBeNull();
  dialog.dispatchEvent(new Event("close"));
  await Promise.resolve();
  expect(storage.remove).toHaveBeenCalledOnce();
});
