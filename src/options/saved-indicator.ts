export const markSavedNow = (): void => {
  const indicator = document.querySelector<HTMLElement>("#lastSavedAt");
  if (!indicator) return;
  indicator.textContent = new Date().toLocaleTimeString();
  indicator.classList.remove("saved-confirmed");
  void indicator.offsetWidth;
  indicator.classList.add("saved-confirmed");
};
