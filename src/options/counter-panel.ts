import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";

export const refreshCounterPanel = () =>
  webExtensionApi.storage.local.get(COUNTER_KEY).then((res) => {
    const valueEl = document.querySelector<HTMLElement>("#counter-value");
    if (valueEl) valueEl.textContent = String((res && res[COUNTER_KEY]) || 0);
  });

export const setupCounterPanel = () => {
  const resetBtn = document.querySelector<HTMLButtonElement>("#counter-reset");
  if (!document.querySelector("#counter-value") || !resetBtn) return;

  void refreshCounterPanel();
  resetBtn.addEventListener("click", () => {
    void webExtensionApi.storage.local.set({ [COUNTER_KEY]: 0 }).then(refreshCounterPanel);
  });
};
