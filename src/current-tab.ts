// The active tab, shared across the background modules. It lives in its own
// leaf module (not index.ts) so the readers — router / shortcut / messaging /
// menu-click — don't import index.ts: that would pull index into the module
// cycle and run its eval-time `window.ready = window.init()` before option.ts
// finishes initializing (a TDZ on OptionsManagement). index.ts stays a pure
// sink, evaluated last.
//
// Reassigned only here (via setCurrentTab); readers import a read-only live
// binding. index.ts's tab listeners call setCurrentTab to update it.

export let currentTab = null;

export const setCurrentTab = (tab) => {
  currentTab = tab;
};
