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
  expect(document.getElementById("section-notifications")?.tagName).toBe("H3");
  expect(document.getElementById("section-notifications")?.closest(".advanced-section")?.id).toBe(
    "advanced-notifications",
  );
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

test("keeps Browser routings actions concise, described, and task ordered", () => {
  const document = documentForOptions();
  const panel = document.getElementById("section-browser-downloads")?.parentElement;
  const controls = [
    ["trackBrowserDownloads", "track-browser-downloads-help"],
    ["routeBrowserDownloads", "route-browser-downloads-help"],
    ["routeBrowserDownloadsFirefox", "route-browser-downloads-firefox-help"],
  ] as const;

  for (const [controlId, helpId] of controls) {
    const control = document.getElementById(controlId);
    const label = document.querySelector(`label[for="${controlId}"]`);
    const help = document.getElementById(helpId);
    expect(control?.getAttribute("aria-describedby")).toContain(helpId);
    expect(label).not.toBeNull();
    expect(label?.contains(help)).toBe(false);
  }

  expect(panel?.querySelector("#browser-download-manage-rules")).not.toBeNull();
  const trackingControl = panel?.querySelector("#trackBrowserDownloads");
  const routingControl = panel?.querySelector("#routeBrowserDownloads");
  expect(trackingControl).not.toBeNull();
  expect(routingControl).not.toBeNull();
  expect(
    trackingControl && routingControl
      ? trackingControl.compareDocumentPosition(routingControl) & Node.DOCUMENT_POSITION_FOLLOWING
      : 0,
  ).toBeTruthy();
  for (const [controlId, summaryId] of [
    ["browserDownloadFilter", "browser-download-filter-error"],
    ["browserDownloadExcludeFilter", "browser-download-exclude-filter-error"],
  ] as const) {
    const control = document.getElementById(controlId);
    expect(control?.getAttribute("data-syntax-validation-summary")).toBe(summaryId);
    expect(control?.getAttribute("aria-describedby")).toContain(summaryId);
    expect(document.getElementById(summaryId)?.getAttribute("role")).toBe("status");
  }
});

test("keeps core feature help separate from checkbox accessible names", () => {
  const document = documentForOptions();
  for (const [controlId, helpId] of [
    ["page", "save-page-help"],
    ["contentClickToSave", "click-to-save-help"],
    ["saveSourceSidecar", "save-source-sidecar-help"],
  ] as const) {
    const control = document.getElementById(controlId);
    const label = document.querySelector(`label[for="${controlId}"]`);
    const help = document.getElementById(helpId);

    expect(control?.getAttribute("aria-describedby")).toContain(helpId);
    expect(label).not.toBeNull();
    expect(help).not.toBeNull();
    expect(label?.contains(help)).toBe(false);
  }
});

test("places Page sources activation before its illustrative preview", () => {
  const document = documentForOptions();
  const activation = document.getElementById("sourcePanelEnabled");
  const preview = document.querySelector(".source-panel-demo");

  expect(activation).not.toBeNull();
  expect(preview).not.toBeNull();
  expect(
    activation && preview
      ? activation.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
      : 0,
  ).toBeTruthy();
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
  expect(document.querySelector<HTMLInputElement>("#notifyDuration")?.type).toBe("hidden");
  expect(document.querySelector<HTMLInputElement>("#notifyDurationSeconds")?.value).toBe("");
  expect(
    document.querySelector("#notifyDurationSeconds")?.getAttribute("data-runtime-control"),
  ).toBe("true");
  expect(document.querySelector<HTMLInputElement>("#truncateLength")?.min).toBe("0");
  expect(document.querySelector<HTMLInputElement>("#truncateLength")?.max).toBe("");
  expect(
    [...document.querySelectorAll<HTMLInputElement>('.theme-picker input[type="radio"]')].map(
      ({ value }) => value,
    ),
  ).toEqual([
    "system",
    "dark",
    "light",
    "high-contrast-dark",
    "high-contrast-light",
    "high-contrast-yellow",
    "solarized-dark",
    "solarized-light",
    "nord",
    "dracula",
    "gruvbox",
    "monokai",
    "one-dark",
    "tokyo-night",
    "catppuccin",
    "midnight",
    "pastel-pink",
    "paper",
    "terminal",
    "berry",
    "nebula",
    "glacier",
    "matcha",
    "ember",
    "primary-grid",
    "blue-house",
    "gilded-mosaic",
  ]);
  expect(document.querySelectorAll(".theme-choice-group")).toHaveLength(4);
  expect(document.querySelectorAll(".theme-swatch")).toHaveLength(27);
  expect(
    [...document.querySelectorAll<HTMLOptionElement>("#shortcutType option")].map(
      ({ value }) => value,
    ),
  ).toEqual(["HTML_REDIRECT", "MAC_WEBLOC", "WINDOWS", "FREEDESKTOP", "MAC"]);
  expect(document.querySelector("#shortcutType")?.getAttribute("aria-describedby")).toContain(
    "shortcut-format-preview",
  );
  expect(document.querySelector("#includeFetchCredentials")).not.toBeNull();
  expect(document.querySelector("#containerAuthPermission")).toBeNull();
});

test("groups Advanced into navigable sections with described controls", () => {
  const document = documentForOptions();
  const sectionLinks = [
    "advanced-appearance",
    "advanced-notifications",
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

test("keeps Diagnostics collapsed and connects its live and privacy guidance", () => {
  const document = documentForOptions();
  const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details");

  expect(details).not.toBeNull();
  expect(details?.hasAttribute("open")).toBe(false);
  expect(document.querySelector("#diagnostics-status")?.getAttribute("role")).toBe("status");
  expect(document.querySelector("#diagnostics-core")?.getAttribute("aria-busy")).toBe("false");
  expect(document.querySelector("#diagnostics-lifecycle")?.tagName).toBe("OL");
  expect(document.querySelector("#debug-log")?.getAttribute("readonly")).not.toBeNull();
  expect(document.querySelector("#debug-log")?.getAttribute("aria-describedby")).toContain(
    "diagnostics-failures-help",
  );
  for (const id of ["debug-log-refresh", "diagnostics-copy", "debug-log-clear"]) {
    expect(document.querySelector(`#${id}`)?.tagName).toBe("BUTTON");
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
  const pending = document.querySelector("#external-download-rejections");
  expect(pending?.hasAttribute("aria-live")).toBe(false);
  expect(pending?.querySelector("#external-download-rejection-status")?.getAttribute("role")).toBe(
    "status",
  );
});

test("marks conditional tab-context requirements without describing supported controls", () => {
  const document = documentForOptions();
  for (const [controlId, requirementId] of [
    ["tabEnabled", "tab-context-requirement"],
    ["shortcutTab", "shortcut-tab-context-requirement"],
  ] as const) {
    const control = document.getElementById(controlId);
    expect(control?.getAttribute("data-tab-context-requirement")).toBe(requirementId);
    expect(control?.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById(requirementId)?.hasAttribute("hidden")).toBe(true);
  }
});

test("uses the shared external-link treatment for Referer documentation", () => {
  const document = documentForOptions();
  const link = document.querySelector<HTMLAnchorElement>(
    'a[href*="developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns"]',
  );
  expect(link?.classList.contains("external")).toBe(true);
  expect(link?.target).toBe("_blank");
  expect(link?.rel).toBe("noreferrer");
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
  expect(document.querySelector("#sourcePanelEnabled")?.getAttribute("aria-controls")).toBe(
    "source-panel-results-options source-panel-dependent-options",
  );
  expect(document.querySelector("#source-panel-results-options #sourcePanelLive")).not.toBeNull();
  expect(
    document.querySelector("#source-panel-dependent-options #sourcePanelShortcutModifier"),
  ).not.toBeNull();
  expect(document.querySelector(".source-browser #autoDownloadEnabled")).toBeNull();
  expect(document.querySelector("figure.source-panel-demo figcaption")).not.toBeNull();
  expect(document.querySelector("figure.source-panel-demo > [aria-hidden='true']")).not.toBeNull();
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

test("keeps the debugger before fallback behavior", () => {
  const document = documentForOptions();
  const fallback = document.querySelector(".routing-post-options");
  const debuggerShell = document.querySelector(".route-debugger-shell");

  const noMatchGroup = fallback?.querySelector("[aria-labelledby='routing-no-match-heading']");
  expect(document.querySelector("#rules-text-label")?.tagName).toBe("H4");
  expect(document.querySelector("#route-debugger-title")?.tagName).toBe("H4");
  expect(document.querySelector("#routing-reference-heading")?.tagName).toBe("H4");
  expect(noMatchGroup?.querySelector("#routing-no-match-heading")?.textContent?.trim()).toBe(
    "__MSG_routingNoMatchBehavior__",
  );
  expect(noMatchGroup?.querySelector("#routeSkipUnmatched")).not.toBeNull();
  expect(noMatchGroup?.querySelector("#routeFailurePrompt")).not.toBeNull();
  const menuGroup = fallback?.querySelector("[aria-labelledby='routing-menu-mode-heading']");
  expect(menuGroup?.querySelector("#routing-menu-mode-heading")?.textContent?.trim()).toBe(
    "Context menus",
  );
  expect(menuGroup?.querySelector("#routeHideFolderChoices")).not.toBeNull();
  expect(fallback?.querySelector("#routeExclusive")).toBeNull();
  if (!fallback || !debuggerShell) throw new Error("Missing routing fallback or debugger group");
  expect(
    Boolean(debuggerShell.compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING),
  ).toBe(true);
});

test("keeps routing references secondary without duplicating the template library", () => {
  const document = documentForOptions();
  const references = document.querySelector(".routing-reference-column");
  const textEditor = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");

  expect(references?.tagName).toBe("ASIDE");
  expect(references?.getAttribute("aria-labelledby")).toBe("routing-reference-heading");
  expect(references?.querySelector(".inline-template-library")).toBeNull();
  expect(document.querySelector("#rule-templates[data-rule-template-library]")).not.toBeNull();
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
