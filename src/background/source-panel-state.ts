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

const send = async (tabId: number, open: boolean) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await webExtensionApi.tabs.sendMessage(tabId, { type: "SET_SOURCE_PANEL", body: { open } });
      return;
    } catch {
      if (attempt < 2) {
        // New tabs can activate and report complete just before their content
        // script accepts messages. Restricted pages exhaust the short retry.
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
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
