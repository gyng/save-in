import { setupPrivacyDialog } from "../src/options/privacy-dialog.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const setupMarkup = () => {
  document.body.innerHTML = `
    <button id="privacy-open">Privacy policy</button>
    <dialog id="privacy-dialog" aria-label="Privacy policy">
      <button class="privacy-close">Close</button>
      <article id="privacy-content"></article>
    </dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => dialog.removeAttribute("open"));
  return dialog;
};

test("places the inline privacy policy immediately above About in Help and resources", () => {
  const html = readFileSync(resolve("src/options/options.html"), "utf8");
  const optionsDocument = new DOMParser().parseFromString(html, "text/html");
  const menu = optionsDocument.querySelector(".nav-resources-menu")!;
  const privacy = menu.querySelector<HTMLButtonElement>("#privacy-open");
  const about = menu.querySelector<HTMLButtonElement>("#about-open");
  const privacyDialog = optionsDocument.querySelector("#privacy-dialog");

  expect(privacy?.type).toBe("button");
  expect(privacy?.nextElementSibling).toBe(about);
  expect(privacyDialog?.tagName).toBe("DIALOG");
  expect(
    privacyDialog?.compareDocumentPosition(optionsDocument.querySelector("#about-dialog")!),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(optionsDocument.querySelector('#about-dialog a[href="../../PRIVACY.md"]')).toBeNull();
});

test("uses the regular type size throughout the Help and resources dropdown", () => {
  const css = readFileSync(resolve("src/options/style.css"), "utf8");
  const menuRules = css.match(/\.nav-resources-menu\s*\{([^}]*)\}/)?.[1];
  expect(menuRules).toContain("font-size: var(--text-base)");
});

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
  expect(document.querySelector("#privacy-content")?.textContent).toContain("Local data");
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

  document.querySelector<HTMLButtonElement>(".privacy-close")!.click();
  expect(dialog.close).toHaveBeenCalledOnce();
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog.close).toHaveBeenCalledTimes(2);
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
  expect(document.querySelector("#privacy-content")?.textContent).toContain("Privacy policy");
  vi.unstubAllGlobals();
});
