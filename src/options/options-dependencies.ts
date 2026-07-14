type Dependency = { parent: string; children: string[]; when?: () => boolean };
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
        "clickToSaveModifier",
        "clickToSaveModifier2",
        "contentClickToSaveButton",
        "clickToSaveButton",
        "clickToSaveApply",
        "clickToSaveReset",
      ],
    },
    {
      parent: "autoDownloadEnabled",
      children: ["autoDownloadLive", "autoDownloadPrivate", "autoDownloadMaxPerPage"],
    },
    { parent: "tabEnabled", children: ["closeTabOnSave"] },
    {
      parent: "setRefererHeader",
      children: ["setRefererHeaderFilter"],
    },
    {
      parent: "browserDownloadFiltersEnabled",
      children: ["browserDownloadFilter", "browserDownloadExcludeFilter"],
    },
    { parent: "links", children: ["preferLinks"] },
    {
      parent: "preferLinks",
      children: ["preferLinksFilterEnabled"],
      when: () => checked("links") && checked("preferLinks"),
    },
    {
      parent: "preferLinksFilterEnabled",
      children: ["preferLinksFilter"],
      when: () => checked("links") && checked("preferLinks") && checked("preferLinksFilterEnabled"),
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
  [...new Set(dependencies.map(({ parent }) => parent))].forEach((id) =>
    optionCheckbox(id)?.addEventListener("change", update),
  );
  update();
  return update;
};
