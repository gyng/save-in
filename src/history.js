/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

const SaveHistory = {
  add: async (entry) => {
    const current = (await browser.storage.local.get(HISTORY_KEY)) || {};
    await browser.storage.local.set({
      [HISTORY_KEY]: [...(current.history || []), entry],
    });
  },
  get: async () => (await browser.storage.local.get(HISTORY_KEY)) || [],
};
