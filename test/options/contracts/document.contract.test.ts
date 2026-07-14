// @vitest-environment jsdom
import { getReadOnlyOptionsDocument } from "./markup.fixture.ts";

const documentForOptions = getReadOnlyOptionsDocument;

const requireIds = (document: Document, ids: string[]) => {
  expect(
    ids.filter((id) => !document.getElementById(id)),
    "missing stable options controls",
  ).toEqual([]);
};

test("keeps the options page hidden until localization completes", () => {
  const document = documentForOptions();
  expect(document.documentElement.classList).toContain("localization-pending");
});

test("uses one main landmark for the settings workflow", () => {
  const document = documentForOptions();
  const main = document.querySelector("main");

  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(main?.contains(document.getElementById("options"))).toBe(true);
});

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

test("gives every static form field an id or name", () => {
  const document = documentForOptions();
  expect(
    [...document.querySelectorAll("input, select, textarea")]
      .filter((control) => !control.hasAttribute("id") && !control.hasAttribute("name"))
      .map((control) => control.outerHTML),
  ).toEqual([]);
});

test.each([
  ["browserDownloadFiltersEnabled", "browser-download-filter-options"],
  ["setRefererHeader", "referer-options"],
] as const)("connects the %s master option to its dependent controls", (controlId, groupId) => {
  const document = documentForOptions();
  const control = document.getElementById(controlId);
  const group = document.getElementById(groupId);

  expect(control?.getAttribute("aria-controls")).toBe(groupId);
  expect(group).not.toBeNull();
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

test("groups Advanced into navigable sections with described controls", () => {
  const document = documentForOptions();
  const sectionLinks = [
    "advanced-appearance",
    "advanced-files-downloads",
    "advanced-maintenance",
    "advanced-integrations",
  ];
  expect(
    [...document.querySelectorAll<HTMLAnchorElement>(".advanced-section-nav a")].map((link) =>
      link.hash.slice(1),
    ),
  ).toEqual(sectionLinks);
  for (const id of sectionLinks) expect(document.getElementById(id)).not.toBeNull();

  for (const [control, help] of [
    ["truncateLength", "truncateLengthHelp"],
    ["replacementChar", "replacementCharHelp"],
    ["appendMimeExtension", "appendMimeExtensionHelp"],
    ["fallbackFetch", "fallbackFetchHelp"],
    ["fetchViaFetch", "fetchViaFetchHelp"],
    ["includeFetchCredentials", "includeFetchCredentialsHelp"],
    ["debug", "debugModeHelp"],
  ] as const) {
    expect(document.getElementById(control)?.getAttribute("aria-describedby")).toContain(help);
    expect(document.getElementById(help)).not.toBeNull();
  }
});

test("uses one shared container for each external integration", () => {
  const document = documentForOptions();
  const integrations = document.querySelectorAll(
    "#advanced-integrations > .advanced-integration-section",
  );
  expect(integrations).toHaveLength(3);
  expect(document.querySelector(".webmcp-developer-details")?.hasAttribute("open")).toBe(false);
  expect(document.querySelector("#webhook-state-badge")?.getAttribute("data-state")).toBe("off");
});

test("keeps webhook consent, field controls, preview, and status connected", () => {
  const document = documentForOptions();
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl");
  expect(endpoint?.type).toBe("url");
  expect(endpoint?.getAttribute("aria-describedby")).toContain("webhook-status");
  expect(document.querySelector("#webhookEnabled")?.hasAttribute("data-no-autosave")).toBe(true);
  expect(document.querySelector("#webhookEnabled")?.getAttribute("aria-describedby")).toContain(
    "webhookEnabledHelp",
  );
  expect(document.querySelector("#webhookIncludePageUrl")).not.toBeNull();
  expect(document.querySelector("#webhookIncludePageTitle")).not.toBeNull();
  expect(document.querySelector("#webhookIncludeSelectionText")).not.toBeNull();
  expect(document.querySelector("#webhook-payload-preview")).not.toBeNull();
  expect(document.querySelector("#webhook-status")?.getAttribute("role")).toBe("status");
  expect(document.querySelector("#webhook-state-badge")).not.toBeNull();
  expect(document.querySelector<HTMLAnchorElement>("#webhook-documentation")?.href).toBe(
    "https://github.com/gyng/save-in/wiki/Webhooks",
  );
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
  for (const id of ["history-date-from", "history-date-to"]) {
    expect(document.getElementById(id)?.getAttribute("aria-describedby")).toContain(
      "history-date-error",
    );
  }
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

test("shares validation feedback after both routing editor panels", () => {
  const document = documentForOptions();
  const errors = document.querySelector("#error-filenamePatterns");

  expect(document.querySelector("#rules-text-editor")?.contains(errors)).toBe(false);
  expect(document.querySelector("#rules-visual")?.contains(errors)).toBe(false);
  expect(errors?.previousElementSibling?.id).toBe("rules-visual");
  expect(document.querySelector("#filenamePatterns")?.getAttribute("aria-describedby")).toContain(
    "error-filenamePatterns",
  );
  expect(document.querySelector("#rules-visual")?.getAttribute("aria-describedby")).toContain(
    "error-filenamePatterns",
  );
  expect(errors?.getAttribute("role")).toBe("status");
});

test("shares validation feedback after both save-location editor panels", () => {
  const document = documentForOptions();
  const errors = document.querySelector("#error-paths");

  expect(document.querySelector("#paths-text-editor")?.contains(errors)).toBe(false);
  expect(document.querySelector("#paths-visual")?.contains(errors)).toBe(false);
  expect(errors?.previousElementSibling?.id).toBe("paths-visual");
  expect(document.querySelector("#paths")?.getAttribute("aria-describedby")).toContain(
    "error-paths",
  );
  expect(document.querySelector("#paths-visual")?.getAttribute("aria-describedby")).toContain(
    "error-paths",
  );
  expect(errors?.getAttribute("role")).toBe("status");
});

test("connects every tab to a labelled tab panel without treating launchers as tabs", () => {
  const document = documentForOptions();

  for (const tab of document.querySelectorAll<HTMLElement>("[role='tab']")) {
    const panelId = tab.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    expect(panel?.getAttribute("role"), tab.id || tab.textContent || "tab").toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby"), panelId || "tabpanel").toBe(tab.id);
  }

  expect(document.querySelector(".reference-launcher-actions [role='tab']")).toBeNull();
  expect(document.querySelector(".reference-launcher-actions")?.getAttribute("role")).toBeNull();
});

test("keeps visual editor actions direct and validation feedback unobstructed", () => {
  const document = documentForOptions();

  expect(document.querySelector("[data-manual-help-for]")).toBeNull();
  expect(document.querySelector("#paths-visual [data-discard='paths']")).not.toBeNull();
  expect(document.querySelector("#paths-visual [data-apply='paths']")).not.toBeNull();
  expect(document.querySelector("#rules-visual [data-discard='filenamePatterns']")).not.toBeNull();
  expect(document.querySelector("#rules-visual [data-apply='filenamePatterns']")).not.toBeNull();
});

test("keeps one primary routing-rule creation path with secondary choices", () => {
  const document = documentForOptions();
  const menu = document.querySelector<HTMLDetailsElement>(".rule-add-menu");

  expect(document.querySelector("#rule-editor-add")).not.toBeNull();
  expect(menu?.contains(document.querySelector("#rule-editor-add-auto"))).toBe(true);
  expect(menu?.contains(document.querySelector("#rule-editor-browse-templates"))).toBe(true);
  expect(document.querySelector(".rule-builder")).toBeNull();
  expect(document.querySelector("#rule-builder-matcher")).toBeNull();
});

test("groups fallback behavior with rules before the debugger", () => {
  const document = documentForOptions();
  const fallback = document.querySelector(".routing-post-options");
  const debuggerShell = document.querySelector(".route-debugger-shell");

  expect(fallback?.querySelector("legend")?.textContent?.trim()).toBe(
    "__MSG_routingNoMatchBehavior__",
  );
  if (!fallback || !debuggerShell) throw new Error("Missing routing fallback or debugger group");
  expect(
    Boolean(fallback.compareDocumentPosition(debuggerShell) & Node.DOCUMENT_POSITION_FOLLOWING),
  ).toBe(true);
});

test("keeps routing references secondary and uses a compact template typeahead", () => {
  const document = documentForOptions();
  const references = document.querySelector(".routing-reference-column");
  const templates = document.querySelector<HTMLElement>(".inline-template-library");
  const picker = templates?.querySelector<HTMLInputElement>("#routing-template-typeahead");
  const textEditor = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");

  expect(references?.tagName).toBe("ASIDE");
  expect(references?.getAttribute("aria-labelledby")).toBe("routing-reference-heading");
  expect(templates?.tagName).toBe("DIV");
  expect(picker?.getAttribute("list")).toBeNull();
  expect(templates?.querySelector("datalist")).toBeNull();
  expect(picker?.getAttribute("autocomplete")).toBe("off");
  expect(
    templates?.querySelector<HTMLButtonElement>(".rule-template-typeahead-add")?.disabled,
  ).toBe(true);
  expect(textEditor?.placeholder).toBe("__MSG_routeTextEmptyExample__");
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

test("keeps the route debugger in its simple testing order", () => {
  const document = documentForOptions();
  const debuggerShell = document.querySelector(".route-debugger-shell");
  const orderedSelectors = [
    "#route-debugger-title",
    "#route-debugger-run",
    "#route-debugger-result",
    ".route-debugger-variables",
  ];
  const orderedElements = orderedSelectors.map((selector) =>
    debuggerShell?.querySelector(selector),
  );

  expect(orderedElements.every(Boolean)).toBe(true);
  expect(
    orderedElements.every(
      (element, index) =>
        index === 0 ||
        Boolean(
          orderedElements[index - 1]!.compareDocumentPosition(element!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ),
  ).toBe(true);
  expect(document.querySelector(".route-debugger-variables")?.hasAttribute("open")).toBe(false);
  expect(document.querySelector(".route-debugger-variables #route-debugger-form")).not.toBeNull();
  expect(
    document.querySelector(".route-debugger-variables-header #route-debugger-use-last"),
  ).not.toBeNull();
  expect(
    document.querySelector(".route-debugger-variables-header #route-debugger-use-sample"),
  ).not.toBeNull();
  expect(document.querySelector("#route-debugger-rules")).toBeNull();
});

test("limits route debugger announcements to its result summary", () => {
  const document = documentForOptions();
  const result = document.querySelector("#route-debugger-result");
  expect(result?.hasAttribute("aria-live")).toBe(false);
});
