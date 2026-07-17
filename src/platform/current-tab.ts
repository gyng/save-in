// The active tab, shared across the background modules. It lives in its own
// leaf module (not background-main.ts) so the readers — router / shortcut /
// messaging / menu-click — don't import the composition root
// cycle and run background bootstrap before option.ts
// finishes initializing (a TDZ on OptionsManagement). background-main.ts stays a pure
// sink, evaluated last.
//
// Reassigned only here (via setCurrentTab); readers import a read-only live
// binding. background-main.ts's tab listeners call setCurrentTab to update it.

// Shared code only depends on this cross-browser subset. Keeping the domain
// model independent of either ambient host package prevents Firefox-only tab
// fields from leaking into the Chrome typecheck (and vice versa).
export type CurrentTab = {
  id?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
  active?: boolean | undefined;
  cookieStoreId?: string | undefined;
};

export let currentTab: CurrentTab | null = null;

export const setCurrentTab = (tab: CurrentTab | null): void => {
  currentTab = tab;
};
