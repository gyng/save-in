import { webExtensionApi } from "../platform/web-extension-api.ts";

const KEY = "sourcePanelOpen";
let fallback = false;
let queue = Promise.resolve();

const read = async (): Promise<boolean> => {
  const storage = webExtensionApi.storage.session;
  if (!storage) return fallback;
  try {
    return Boolean((await storage.get(KEY))[KEY]);
  } catch {
    return fallback;
  }
};

const write = async (open: boolean) => {
  fallback = open;
  try {
    await webExtensionApi.storage.session?.set({ [KEY]: open });
  } catch {
    // Firefox/older hosts without session storage retain the worker-local fallback.
  }
};

const send = async (tabId: number, open: boolean) => {
  try {
    await webExtensionApi.tabs.sendMessage(tabId, { type: "SET_SOURCE_PANEL", body: { open } });
  } catch {
    // Restricted pages and tabs without the content script cannot host the drawer.
  }
};

export const toggleSourcePanelForTab = (tabId: number): Promise<void> => {
  queue = queue.then(async () => {
    const open = !(await read());
    await write(open);
    await send(tabId, open);
  });
  return queue;
};

export const syncSourcePanelToTab = async (tabId: number): Promise<void> =>
  send(tabId, await read());
