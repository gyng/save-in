export const MENU_IDS = {
  TABSTRIP: {
    SELECTED_TAB: "save-in-SI-selected-tab",
    SELECTED_MULTIPLE_TABS: "save-in-SI-selected-multiple-tabs",
    TO_RIGHT: "save-in-SI-to-right",
    TO_RIGHT_MATCH: "save-in-SI-to-right-match",
    OPENED_FROM_TAB: "save-in-SI-opened-from-tab",
  },
  CONTEXT: {
    MEDIA_LINK: "download-context-media-link",
    MEDIA: "download-context-media",
    SELECTION: "download-context-selection",
    PAGE: "download-context-page",
  },
  ROUTE_EXCLUSIVE: "save-in-route-exclusive",
  ROOT: "save-in-root",
  QUICK_SAVE: "save-in-quick-save",
  QUICK_SAVE_TO_DIRECTORY: "save-in-quick-save-to-directory",
  LAST_USED: "save-in-last-used",
  RECENT: "save-in-recent",
  recentDestination: (index: number) => `save-in-recent-${index}`,
  OPTIONS: "options",
  TOGGLE_SOURCE_PANEL: "toggle-source-panel",
  SHOW_DEFAULT_FOLDER: "show-default-folder",
  SEPARATOR: {
    LAST_USED: "save-in-separator-last-used",
    ACTIONS: "save-in-separator-actions",
  },
} as const;

// Keyboard command name; must match the manifest `commands` key. Distinct from
// the MENU_IDS.QUICK_SAVE menu-item id.
export const QUICK_SAVE_COMMAND = "quick-save";
