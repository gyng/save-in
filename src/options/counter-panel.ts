import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";

export const refreshCounterPanel = () =>
  webExtensionApi.storage.local.get(COUNTER_KEY).then((res) => {
    const valueEl = document.querySelector<HTMLInputElement>("#counter-value");
    if (valueEl) valueEl.value = String(res[COUNTER_KEY] || 0);
  });

export const parseCounterValue = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export const setupCounterPanel = () => {
  const resetBtn = document.querySelector<HTMLButtonElement>("#counter-reset");
  const setBtn = document.querySelector<HTMLButtonElement>("#counter-set");
  const valueEl = document.querySelector<HTMLInputElement>("#counter-value");
  if (!valueEl || !setBtn || !resetBtn) return;

  void refreshCounterPanel();
  const setValue = () => {
    const value = parseCounterValue(valueEl.value);
    valueEl.setCustomValidity(value == null ? "Enter a whole number of 0 or more" : "");
    if (value == null) {
      valueEl.reportValidity();
      return;
    }
    void webExtensionApi.storage.local.set({ [COUNTER_KEY]: value }).then(refreshCounterPanel);
  };
  setBtn.addEventListener("click", setValue);
  valueEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setValue();
  });
  resetBtn.addEventListener("click", () => {
    void webExtensionApi.storage.local.set({ [COUNTER_KEY]: 0 }).then(refreshCounterPanel);
  });
};
