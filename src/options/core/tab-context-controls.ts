export const updateTabContextControls = (available: boolean, root: ParentNode = document): void => {
  root.querySelectorAll<HTMLInputElement>(".tab-context-required").forEach((control) => {
    const requirementId = control.dataset.tabContextRequirement;
    const describedBy = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/));
    describedBy.delete("");
    if (requirementId) {
      const badge = root.querySelector<HTMLElement>(`#${requirementId}`);
      if (badge) badge.hidden = available;
      if (available) describedBy.delete(requirementId);
      else describedBy.add(requirementId);
    }
    control.disabled = !available;
    if (describedBy.size) control.setAttribute("aria-describedby", [...describedBy].join(" "));
    else control.removeAttribute("aria-describedby");
  });
};
