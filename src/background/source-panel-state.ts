import { webExtensionApi } from "../platform/web-extension-api.ts";
import { SOURCE_PANEL_OPEN_SESSION_KEY } from "../shared/storage-keys.ts";

let fallback = false;
let queue = Promise.resolve();

const read = async (): Promise<boolean> => {
  const storage = webExtensionApi.storage.session;
  if (!storage) return fallback;
  try {
    return Boolean(
      (await storage.get(SOURCE_PANEL_OPEN_SESSION_KEY))[SOURCE_PANEL_OPEN_SESSION_KEY],
    );
  } catch {
    return fallback;
  }
};

const write = async (open: boolean) => {
  fallback = open;
  try {
    await webExtensionApi.storage.session?.set({ [SOURCE_PANEL_OPEN_SESSION_KEY]: open });
  } catch {
    // Firefox/older hosts without session storage retain the worker-local fallback.
  }
};

const send = async (tabId: number, message: object) => {
  try {
    await webExtensionApi.tabs.sendMessage(tabId, message);
  } catch {
    // Restricted pages and tabs without the content script cannot host the drawer.
  }
};

export const setSourcePanelOpenState = (open: boolean): Promise<void> => {
  queue = queue.then(() => write(open));
  return queue;
};

export const toggleSourcePanelForTab = (tabId: number): Promise<void> => {
  queue = queue.then(() => send(tabId, { type: "TOGGLE_SOURCE_PANEL", body: { force: true } }));
  return queue;
};

export const syncSourcePanelToTab = (tabId: number): Promise<void> => {
  queue = queue.then(async () =>
    send(tabId, { type: "SET_SOURCE_PANEL", body: { open: await read() } }),
  );
  return queue;
};
