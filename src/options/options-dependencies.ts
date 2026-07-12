type Dependency = { parent: string; children: string[]; when?: () => boolean };

export const setupOptionDependencies = () => {
  const checked = (id: string) => {
    const control = document.getElementById(id) as HTMLInputElement | null;
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
      ],
    },
    { parent: "tabEnabled", children: ["closeTabOnSave"] },
    {
      parent: "setRefererHeader",
      children: ["setRefererHeaderFilter"],
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
        const control = document.getElementById(id) as HTMLInputElement | null;
        if (control) control.disabled = !enabled;
      });
    });
  };
  [...new Set(dependencies.map(({ parent }) => parent))].forEach((id) =>
    document.getElementById(id)?.addEventListener("change", update),
  );
  update();
  return update;
};
