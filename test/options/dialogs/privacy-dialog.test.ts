// @vitest-environment jsdom
import { setupPrivacyDialog } from "../../../src/options/dialogs/privacy-dialog.ts";

const setupMarkup = () => {
  document.body.innerHTML = `
    <details open>
      <summary>Help & resources</summary>
      <button id="privacy-open">Privacy policy</button>
    </details>
    <dialog id="privacy-dialog" aria-label="Privacy policy">
      <button class="privacy-close">Close</button>
      <article id="privacy-content"></article>
    </dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });
  return dialog;
};

test("opens the privacy modal and renders the canonical packaged Markdown", async () => {
  const dialog = setupMarkup();
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () =>
      Promise.resolve(
        "# Save In Privacy Policy\n\nLast updated: today\n\n## Local data\n\nNothing is uploaded.\n\n- One\n- Two\n\nQuestions: https://example.com/privacy.",
      ),
  });
  vi.stubGlobal("fetch", fetch);

  setupPrivacyDialog();
  document.querySelector<HTMLButtonElement>("#privacy-open")!.click();
  await vi.waitFor(() => expect(document.querySelector("#privacy-content h1")).not.toBeNull());

  expect(dialog.showModal).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/PRIVACY\.md$/));
  expect(document.querySelector("#privacy-content h2")).not.toBeNull();
  expect(document.querySelectorAll("#privacy-content li")).toHaveLength(2);
  expect(document.querySelector<HTMLAnchorElement>("#privacy-content a")?.href).toBe(
    "https://example.com/privacy",
  );
  vi.unstubAllGlobals();
});

test("closes the privacy modal from its close button and backdrop", () => {
  const dialog = setupMarkup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  setupPrivacyDialog();

  document.querySelector<HTMLButtonElement>("#privacy-open")!.click();
  const close = document.querySelector<HTMLButtonElement>(".privacy-close")!;
  close.focus();
  close.click();
  expect(dialog.close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(document.querySelector("summary"));
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog.close).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

test("uses a standalone opener as the focus target and tolerates its removal", () => {
  const dialog = setupMarkup();
  const details = document.querySelector("details")!;
  const open = document.querySelector<HTMLButtonElement>("#privacy-open")!;
  details.replaceWith(open);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  setupPrivacyDialog();

  open.click();
  open.remove();
  expect(() => dialog.dispatchEvent(new Event("close"))).not.toThrow();
  vi.unstubAllGlobals();
});

test("offers the canonical document when loading fails", async () => {
  setupMarkup();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
  setupPrivacyDialog();
  document.querySelector<HTMLButtonElement>("#privacy-open")!.click();

  await vi.waitFor(() =>
    expect(document.querySelector<HTMLAnchorElement>("#privacy-content a")?.href).toMatch(
      /PRIVACY\.md$/,
    ),
  );
  vi.unstubAllGlobals();
});

test("contains unsuccessful responses and only starts one packaged-policy request", async () => {
  const dialog = setupMarkup();
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  vi.stubGlobal("fetch", fetch);
  setupPrivacyDialog();
  const open = document.querySelector<HTMLButtonElement>("#privacy-open")!;
  open.click();
  open.click();

  await vi.waitFor(() => expect(document.querySelector("#privacy-content a")).not.toBeNull());
  expect(fetch).toHaveBeenCalledOnce();
  expect(dialog.showModal).toHaveBeenCalledTimes(2);
  expect(document.querySelector("#privacy-content")?.hasAttribute("aria-busy")).toBe(false);
  vi.unstubAllGlobals();
});

test("does nothing when required dialog controls are absent", () => {
  document.body.innerHTML = '<button id="privacy-open">Privacy</button>';
  expect(setupPrivacyDialog()).toBeUndefined();
});

test("renders multiline prose, star lists, and links without trailing punctuation", async () => {
  setupMarkup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          "Intro line\ncontinues here with https://example.com/policy\n\n* First\n* Second",
        ),
    }),
  );
  setupPrivacyDialog();
  document.querySelector<HTMLButtonElement>("#privacy-open")!.click();

  await vi.waitFor(() => expect(document.querySelectorAll("#privacy-content li")).toHaveLength(2));
  expect(document.querySelector("#privacy-content p")?.textContent).toContain(
    "Intro line continues here",
  );
  expect(document.querySelector<HTMLAnchorElement>("#privacy-content a")?.href).toBe(
    "https://example.com/policy",
  );
  vi.unstubAllGlobals();
});

test("uses concrete fallback copy when the open control has no text", async () => {
  setupMarkup();
  document.querySelector("#privacy-open")!.textContent = "";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
  setupPrivacyDialog();
  document.querySelector<HTMLButtonElement>("#privacy-open")!.click();

  await vi.waitFor(() =>
    expect(document.querySelector("#privacy-content a")?.textContent).toBe("Privacy policy"),
  );
  vi.unstubAllGlobals();
});
