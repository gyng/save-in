type Dependency = {
  parent: string;
  children: string[];
  when?: () => boolean;
  watches?: string[];
};
type DisableableControl =
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

const optionCheckbox = (id: string): HTMLInputElement | null => {
  const control = document.getElementById(id);
  return control instanceof HTMLInputElement && control.type === "checkbox" ? control : null;
};

const disableableControl = (id: string): DisableableControl | null => {
  const control = document.getElementById(id);
  return control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
    ? control
    : null;
};

export const setupOptionDependencies = () => {
  const checked = (id: string) => {
    const control = optionCheckbox(id);
    return control?.checked === true && !control.disabled;
  };
  const dependencies: Dependency[] = [
    {
      parent: "contentClickToSave",
      children: [
        "contentClickToSaveCombo",
        "contentClickToSaveBindings",
        "clickToSaveModifier",
        "clickToSaveModifier2",
        "contentClickToSaveButton",
        "contentClickToSaveLongPressMs",
        "clickToSaveButton",
        "clickToSaveApply",
        "clickToSaveAdd",
        "clickToSaveReset",
      ],
    },
    {
      parent: "autoDownloadEnabled",
      children: [
        "autoDownloadLive",
        "autoDownloadPrivate",
        "autoDownloadLinks",
        "autoDownloadDocuments",
        "autoDownloadBackgrounds",
        "autoDownloadManifests",
        "autoDownloadDataUrls",
        "autoDownloadMaxPerPage",
      ],
    },
    {
      parent: "sourcePanelEnabled",
      children: [
        "sourcePanelLive",
        "sourcePanelPreviews",
        "sourcePanelBackgrounds",
        "sourcePanelResourceHints",
        "sourcePanelLinks",
        "sourcePanelShortcutModifier",
        "sourcePanelShortcutModifier2",
        "sourcePanelShortcutKey",
        "sourcePanelShortcutApply",
        "sourcePanelShortcutReset",
      ],
    },
    { parent: "tabEnabled", children: ["closeTabOnSave"] },
    {
      parent: "quickSaveEnabled",
      children: ["quickSaveDirectory", "quickSaveUseDirectory"],
    },
    {
      parent: "setRefererHeader",
      children: ["setRefererHeaderFilter"],
    },
    {
      parent: "fallbackFetch",
      watches: ["fetchViaFetch"],
      children: ["includeFetchCredentials"],
      when: () => checked("fallbackFetch") || checked("fetchViaFetch"),
    },
    {
      parent: "browserDownloadFiltersEnabled",
      children: ["browserDownloadFilter", "browserDownloadExcludeFilter"],
    },
    {
      parent: "routeSkipUnmatched",
      children: ["routeFailurePrompt"],
      when: () => !checked("routeSkipUnmatched"),
    },
    // Siblings, not a chain. preferLinks prefers links on every page; the
    // filter prefers them only on matching ones, and menu-target.ts evaluates
    // the two independently. So the filter is only useful while preferLinks is
    // OFF — chaining it behind preferLinks left "Only on matching pages"
    // reachable exclusively in the state where it can no longer narrow
    // anything, which is the one configuration #100 asked for.
    { parent: "links", children: ["preferLinks", "preferLinksFilterEnabled"] },
    {
      parent: "preferLinksFilterEnabled",
      children: ["preferLinksFilter"],
      when: () => checked("links") && checked("preferLinksFilterEnabled"),
    },
  ];
  const update = () => {
    dependencies.forEach(({ parent, children, when }) => {
      const enabled = when ? when() : checked(parent);
      children.forEach((id) => {
        const control = disableableControl(id);
        if (control) control.disabled = !enabled;
      });
    });
  };
  [...new Set(dependencies.flatMap(({ parent, watches = [] }) => [parent, ...watches]))].forEach(
    (id) => optionCheckbox(id)?.addEventListener("change", update),
  );
  update();
  return update;
};
