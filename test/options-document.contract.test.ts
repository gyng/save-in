// @vitest-environment jsdom
import { parseOptionsDocument } from "./options-markup-helpers.ts";

const documentForOptions = parseOptionsDocument;

const requireIds = (document: Document, ids: string[]) => {
  expect(
    ids.filter((id) => !document.getElementById(id)),
    "missing stable options controls",
  ).toEqual([]);
};

test("keeps stable controls for each options workflow", () => {
  const document = documentForOptions();
  requireIds(document, [
    "section-downloads",
    "section-browser-downloads",
    "section-dynamic-downloads",
    "section-notifications",
    "section-save-as-shortcuts",
    "section-keyboard-shortcuts",
    "section-page-sources",
    "section-history",
    "section-more-options",
    "paths",
    "filenamePatterns",
    "route-debugger-form",
    "route-debugger-run",
    "route-debugger-result",
    "contentClickToSave",
    "sourcePanelEnabled",
    "history-filter",
    "externalDownloadAllowlist",
    "uiTheme",
    "privacy-open",
    "privacy-dialog",
    "privacy-content",
    "about-open",
    "about-dialog",
    "about-version",
    "reference-dialog",
    "options-reference-variables",
    "options-reference-clauses",
  ]);
});

test("keeps behavior controls owned by their semantic groups", () => {
  const document = documentForOptions();
  const expected = {
    "context-menu": [
      "enableLastLocation",
      "links",
      "preferLinks",
      "preferLinksFilterEnabled",
      "selection",
      "page",
      "tabEnabled",
      "closeTabOnSave",
    ],
    "save-dialog": ["prompt", "promptIfNoExtension", "promptOnShift", "promptOnFailure"],
    "existing-files": ["conflictAction"],
    "context-menu-access-keys": ["keyRoot", "keyLastUsed", "enableNumberedItems"],
  };

  for (const [group, ids] of Object.entries(expected)) {
    for (const id of ids) {
      expect(
        document
          .getElementById(id)
          ?.closest("[data-behavior-group]")
          ?.getAttribute("data-behavior-group"),
      ).toBe(group);
    }
  }
});

test("preserves backward-compatible option defaults", () => {
  const document = documentForOptions();
  expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier")?.value).toBe("Alt");
  expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier2")?.value).toBe("");
  expect(document.querySelector<HTMLSelectElement>("#clickToSaveButton")?.value).toBe("LEFT_CLICK");
  expect(document.querySelector<HTMLInputElement>("#truncateLength")?.min).toBe("0");
  expect(document.querySelector<HTMLInputElement>("#truncateLength")?.max).toBe("");
  expect(
    [...document.querySelectorAll<HTMLOptionElement>("#uiTheme option")].map(({ value }) => value),
  ).toEqual(["system", "dark", "light"]);
  expect(document.querySelector("#includeFetchCredentials")).not.toBeNull();
  expect(document.querySelector("#containerAuthPermission")).toBeNull();
});

test("keeps stable history controls and export commands", () => {
  const document = documentForOptions();
  const runtimeControls = [
    "history-filter",
    "history-source-filter",
    "history-status-filter",
    "history-type-filter",
    "history-date-preset",
    "history-date-from",
    "history-date-to",
  ];
  requireIds(document, [
    ...runtimeControls,
    "history-column-options",
    "history-export-json",
    "history-export-csv",
    "history-export-tsv",
    "history-clear",
  ]);
  expect(
    runtimeControls.every(
      (id) => document.getElementById(id)?.getAttribute("data-runtime-control") === "true",
    ),
  ).toBe(true);
});

test("keeps stable Page Sources controls", () => {
  const document = documentForOptions();
  requireIds(document, [
    "sourcePanelEnabled",
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadPrivate",
    "autoDownloadMaxPerPage",
    "auto-download-manage-rules",
    "rule-editor-add-auto",
    "sourcePanelShortcutModifier",
    "sourcePanelShortcutModifier2",
    "sourcePanelShortcutKey",
  ]);
  expect(document.querySelector("#sourcePanelShortcutKey")?.getAttribute("list")).toBe(
    "sourcePanelShortcutKeys",
  );
  expect(document.querySelector("#autoDownloadRules")).toBeNull();
  expect(document.querySelector("#autoDownloadMaxPerPage")?.getAttribute("max")).toBe("500");
});

test("keeps editor controls connected to their stable labels", () => {
  const document = documentForOptions();
  expect(document.querySelector("#paths")?.getAttribute("aria-labelledby")).toBe(
    "paths-editor-label",
  );
  expect(document.querySelector("#filenamePatterns")?.getAttribute("aria-labelledby")).toBe(
    "rules-text-label",
  );
  requireIds(document, ["paths-editor-label", "rules-text-label", "paths-text-actions"]);
});

test("keeps routing validation feedback available in both editor modes", () => {
  const document = documentForOptions();
  const errors = document.querySelector("#error-filenamePatterns");

  expect(errors?.closest('[role="tabpanel"]')).toBeNull();
  expect(document.querySelector("#filenamePatterns")?.getAttribute("aria-describedby")).toContain(
    "error-filenamePatterns",
  );
  expect(document.querySelector("#rules-visual")?.getAttribute("aria-describedby")).toContain(
    "error-filenamePatterns",
  );
});

test("keeps manual-save guidance beside Apply in both visual editors", () => {
  const document = documentForOptions();

  for (const [editor, field] of [
    ["#paths-visual", "paths"],
    ["#rules-visual", "filenamePatterns"],
  ]) {
    const help = document.querySelector(
      `${editor} .visual-editor-toolbar > [data-manual-help-for="${field}"]`,
    );
    expect(help?.textContent?.trim()).toBe("__MSG_o_lManualEditorSaveHelp__");
  }

  expect(document.querySelector(".rule-editor-help")?.hasAttribute("data-manual-help-for")).toBe(
    false,
  );
});

test("keeps route debugger inputs out of persisted option handling", () => {
  const document = documentForOptions();
  for (const id of [
    "route-debugger-filename",
    "route-debugger-source-url",
    "route-debugger-page-url",
    "route-debugger-mime",
    "route-debugger-context",
    "route-debugger-page-title",
    "route-debugger-referrer-url",
    "route-debugger-frame-url",
    "route-debugger-link-text",
    "route-debugger-selection-text",
    "route-debugger-media-type",
  ]) {
    expect(document.getElementById(id)?.hasAttribute("data-no-autosave"), id).toBe(true);
  }
});

test("keeps the route debugger available without opening it by default", () => {
  const document = documentForOptions();
  const summary = document.querySelector("#route-debugger-title");
  const disclosure = summary?.closest("details");

  expect(disclosure?.hasAttribute("open")).toBe(false);
  expect(disclosure?.querySelector("#route-debugger-form")).not.toBeNull();
});
