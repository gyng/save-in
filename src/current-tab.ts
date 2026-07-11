// The active tab, shared across the background modules. It lives in its own
// leaf module (not background-main.ts) so the readers — router / shortcut /
// messaging / menu-click — don't import the composition root
// cycle and run its eval-time `window.ready = window.init()` before option.ts
// finishes initializing (a TDZ on OptionsManagement). background-main.ts stays a pure
// sink, evaluated last.
//
// Reassigned only here (via setCurrentTab); readers import a read-only live
// binding. background-main.ts's tab listeners call setCurrentTab to update it.

export type CurrentTab = Partial<browser.tabs.Tab>;

export let currentTab: CurrentTab | null = null;

export const setCurrentTab = (tab: CurrentTab | null): void => {
  currentTab = tab;
};
