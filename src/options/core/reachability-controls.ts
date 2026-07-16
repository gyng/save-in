import {
  REACHABILITY_OPTION_IDS,
  readReachabilityOptions,
  type ReachabilityOptions,
} from "./rule-reachability-model.ts";

type ReachabilityOptionId = (typeof REACHABILITY_OPTION_IDS)[number];

// The one DOM reader both reachability surfaces share, so the Visual editor
// and the route debugger cannot drift on how they observe the discovery
// checkboxes. Reads live control state, saved or not — the hints must
// describe the page the user is looking at.
export const readReachabilityControls = (): ReachabilityOptions =>
  readReachabilityOptions((id) => {
    const control = document.getElementById(id);
    return control instanceof HTMLInputElement && control.type === "checkbox" && control.checked;
  });

// Change events cover user toggles; "options-restored" covers programmatic
// writes (settings import, reset, configuration tools), which set .checked
// without firing change. A surface whose full render already follows
// "options-restored" passes includeRestore: false to avoid double work.
export const subscribeReachabilityControls = (
  ids: readonly ReachabilityOptionId[],
  onChange: () => void,
  includeRestore = true,
): void => {
  for (const id of ids) {
    const control = document.getElementById(id);
    if (control instanceof HTMLInputElement) control.addEventListener("change", onChange);
  }
  if (includeRestore) document.addEventListener("options-restored", onChange);
};
