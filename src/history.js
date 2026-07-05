/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";
const HISTORY_MAX = 500;

const SaveHistory = {
  add: async (entry) => {
    const current = (await browser.storage.local.get(HISTORY_KEY)) ?? {};
    const updated = [...(current.history ?? []), entry];
    if (updated.length > HISTORY_MAX) {
      updated.splice(0, updated.length - HISTORY_MAX);
    }
    await browser.storage.local.set({
      [HISTORY_KEY]: updated,
    });
  },
  get: async () => (await browser.storage.local.get(HISTORY_KEY)) ?? [],
};
