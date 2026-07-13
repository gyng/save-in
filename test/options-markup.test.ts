import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const documentForOptions = () =>
  new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );

describe("options form semantics", () => {
  test("each label contains at most one labelable control", () => {
    const document = documentForOptions();
    const invalid = [...document.querySelectorAll("label")]
      .map((label) => [...label.querySelectorAll("input, select, textarea")].map((el) => el.id))
      .filter((ids) => ids.length > 1);
    expect(invalid).toEqual([]);
  });

  test("every visible form control has an accessible name", () => {
    const document = documentForOptions();
    const explicitLabels = new Set(
      [...document.querySelectorAll<HTMLLabelElement>("label[for]")].map((label) => label.htmlFor),
    );
    const unnamed = [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
      .filter((control) => !control.hidden)
      .filter(
        (control) =>
          !control.closest("label") &&
          !explicitLabels.has(control.id) &&
          !control.hasAttribute("aria-label") &&
          !control.hasAttribute("aria-labelledby"),
      )
      .map((control) => control.id || control.className);
    expect(unnamed).toEqual([]);
  });

  test("browser setup does not override the responsive viewport width", () => {
    const source = readFileSync(resolve("src/options/options.ts"), "utf8");
    expect(source).not.toMatch(/\.style\.minWidth\s*=/);
  });

  test("opens vocabulary references from a separate top-bar tabstrip", () => {
    const document = documentForOptions();
    expect(document.querySelector(".open-settings-in-window")).toBeNull();
    expect(document.querySelector('a[href="clauselist.html"]')).toBeNull();
    expect(document.querySelector('a[href="variablelist.html#clauses"]')).toBeNull();
    expect(document.querySelectorAll("[data-reference-tab]").length).toBeGreaterThan(1);
    expect(document.querySelectorAll(".reference-launcher-tabs [role=tab]")).toHaveLength(3);
    expect(document.querySelector("#reference-dialog #options-reference-variables")).not.toBeNull();
    expect(document.querySelector("#reference-dialog #options-reference-clauses")).not.toBeNull();
    expect(
      document.querySelector("#reference-dialog #options-reference-templates #rule-templates"),
    ).not.toBeNull();
  });

  test("save-dialog conditions are grouped beneath a regular-size prompt", () => {
    const document = documentForOptions();
    const prompt = document.querySelector(".save-dialog-conditions-label");
    const conditions = document.querySelector(".save-dialog-conditions");
    expect(prompt?.classList.contains("caption")).toBe(false);
    expect(conditions?.querySelectorAll(":scope > label")).toHaveLength(3);
  });

  test("keeps last-download details in the left side of the routing grid", () => {
    const document = documentForOptions();
    const row = document.querySelector(".last-download-row");
    expect(row?.parentElement?.classList.contains("rules-editor-main")).toBe(true);
    expect(document.querySelector(".routing-post-options")?.parentElement).toBe(row?.parentElement);
  });

  test("keeps artifact shortcuts separate from keyboard behavior", () => {
    const document = documentForOptions();
    expect(
      [...document.querySelectorAll("#options > h2, #options > .column > h2")].map((h) => h.id),
    ).toEqual([
      "section-downloads",
      "section-browser-downloads",
      "section-dynamic-downloads",
      "section-notifications",
      "section-save-as-shortcuts",
      "section-keyboard-shortcuts",
      "section-page-sources",
      "section-history",
      "section-more-options",
    ]);
  });

  test("places context-menu access keys with Downloads and leaves click-to-save in its tab", () => {
    const document = documentForOptions();
    const downloads = document.querySelector("#section-downloads")!;
    const browserDownloads = document.querySelector("#section-browser-downloads")!;
    const clickToSave = document.querySelector("#section-keyboard-shortcuts")!;
    const clickToSaveControl = document.querySelector("#contentClickToSave")!;
    const pageSources = document.querySelector("#section-page-sources")!;
    const accessKeys = document.querySelector('[data-behavior-group="context-menu-access-keys"]')!;

    expect(
      downloads.compareDocumentPosition(accessKeys) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      accessKeys.compareDocumentPosition(browserDownloads) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(accessKeys.contains(document.querySelector("#keyRoot"))).toBe(true);
    expect(
      clickToSave.compareDocumentPosition(clickToSaveControl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      clickToSaveControl.compareDocumentPosition(pageSources) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps Alt + left click as the fresh-profile click-to-save default", () => {
    const document = documentForOptions();
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier")?.value).toBe("Alt");
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier2")?.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveButton")?.value).toBe(
      "LEFT_CLICK",
    );
  });

  test("allows the documented zero value to disable path truncation", () => {
    const document = documentForOptions();
    expect(document.querySelector<HTMLInputElement>("#truncateLength")?.min).toBe("0");
  });

  test("makes authenticated extension requests an explicit advanced option", () => {
    const document = documentForOptions();
    const fetchCredentials = document.querySelector<HTMLInputElement>("#includeFetchCredentials");
    const containerPermission = document.querySelector<HTMLInputElement>(
      "#containerAuthPermission",
    );

    expect(fetchCredentials).not.toBeNull();
    expect(fetchCredentials?.closest("label")?.textContent).toContain(
      "__MSG_o_cIncludeFetchCredentials__",
    );
    expect(containerPermission?.closest(".firefox-only")?.textContent).toContain(
      "__MSG_o_cContainerAuthPermission__",
    );
  });

  test("makes default Downloads-folder help directly openable", () => {
    const document = documentForOptions();
    const links = document.querySelectorAll<HTMLAnchorElement>(
      "[data-open-default-downloads-folder]",
    );
    expect(links).toHaveLength(4);
    const editorHelp = document.querySelector("#paths-editor-description")!;
    expect(editorHelp.tagName).toBe("SPAN");
    expect(editorHelp.querySelectorAll("a[data-open-default-downloads-folder]")).toHaveLength(1);
    expect(editorHelp.querySelector("a")?.textContent?.trim()).toBe("default Downloads directory");
    expect([...links].every((link) => link.getAttribute("href") === "#")).toBe(true);
  });

  test("uses one heading-and-lead pattern for the three download workflows", () => {
    const document = documentForOptions();
    const headings = [...document.querySelectorAll<HTMLElement>(".section-task-heading")];
    expect(headings).toHaveLength(3);
    expect(headings.every((heading) => heading.nextElementSibling?.matches("p.section-lead"))).toBe(
      true,
    );
  });

  test("groups external automation under one clear integrations heading", () => {
    const document = documentForOptions();
    const heading = [...document.querySelectorAll("h3")].find(
      (node) => node.textContent?.trim() === "External integrations",
    );
    expect(heading).toBeDefined();
    const subheadings = [...document.querySelectorAll("h4")].map((node) =>
      node.textContent?.replaceAll(/\s+/g, " ").trim(),
    );
    expect(subheadings).toEqual(
      expect.arrayContaining(["External download API", "WebMCP __MSG_o_lExperimental__"]),
    );
    expect(document.body.textContent).toContain("Greasemonkey");
    expect(document.body.textContent).toContain("Video DownloadHelper");
    expect(document.body.textContent).toContain("does not adopt downloads already started");
  });

  test("explains match patterns where browser-download filters are configured", () => {
    const document = documentForOptions();
    const guide = [...document.querySelectorAll("details")].find((details) =>
      details.querySelector("summary")?.textContent?.includes("download URL filters"),
    );
    expect(guide?.textContent).toContain("not a regular expression");
    expect(guide?.textContent).toContain("<scheme>://<host>/<path>");
    expect(guide?.textContent).toContain("cannot match query parameters");
  });

  test("offers copy-ready AI prompts in both editor guides", () => {
    const document = documentForOptions();
    const prompts = document.querySelectorAll(".agent-prompt-guide pre.click-to-copy");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.textContent).toContain("one menu instruction per line");
    expect(prompts[0]?.textContent).toContain("Variables use :name: syntax");
    expect(prompts[0]?.textContent).toContain("Never use an absolute path");
    expect(prompts[1]?.textContent).toContain("Every rule must contain exactly one into:");
    expect(prompts[1]?.textContent).toContain("Common matchers are filename:");
    expect(prompts[1]?.textContent).toContain("Matcher values are JavaScript regular expressions");
    expect(document.querySelectorAll(".agent-prompt-guide a.external")).toHaveLength(2);
  });

  test("uses progressive native disclosures for both editor guides", () => {
    const document = documentForOptions();
    const guides = [...document.querySelectorAll<HTMLDetailsElement>("details.editor-guide")];
    expect(guides).toHaveLength(2);
    expect(
      guides.map((guide) => guide.querySelector(":scope > summary")?.textContent?.trim()),
    ).toEqual(["How to create destinations", "How routing rules work"]);
    expect(document.querySelectorAll("[data-help-for]")).toHaveLength(0);

    const menuGuide = guides[0]!;
    expect(
      menuGuide.querySelectorAll(":scope > .guide-body > .guide-steps .guide-step"),
    ).toHaveLength(5);
    expect(menuGuide.textContent).toContain("Each > adds one nesting level");
    expect(menuGuide.textContent).toContain("More menu syntax");

    const routingGuide = guides[1]!;
    expect(routingGuide.textContent).toContain("Separate rules with a blank line");
    expect(routingGuide.textContent).toContain("Every matcher in a rule must match");
    expect(routingGuide.textContent).toContain("Advanced: use capture groups");

    const edgeCase = [
      ...document.querySelectorAll<HTMLDetailsElement>("details.edge-case-guide"),
    ].find((guide) =>
      guide.querySelector("summary")?.textContent?.includes("outside the Downloads"),
    );
    expect(edgeCase).toBeDefined();
    expect(
      document.querySelector(".paths-editor")!.compareDocumentPosition(edgeCase!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

test("does not retain links to the retired old-rules migration page", () => {
  const projectCopy = [
    readFileSync(resolve("src/options/options.html"), "utf8"),
    readFileSync(resolve("CHANGELOG.md"), "utf8"),
  ].join("\n");
  expect(projectCopy).not.toContain("Filename-rewrite");
  expect(projectCopy).not.toContain("Migrating old rules");
});
