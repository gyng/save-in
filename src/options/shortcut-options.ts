import { SHORTCUT_EXTENSIONS } from "../shared/constants.ts";

const EFFECTIVE_ACCESS_KEY = /^[a-z0-9]$/i;
const FORMAT_GUIDANCE: Record<string, { filename: string; meaning: string }> = {
  HTML_REDIRECT: { filename: "page.html", meaning: "Works in any browser" },
  MAC: { filename: "page.url", meaning: "Legacy Internet Shortcut" },
  MAC_WEBLOC: { filename: "page.webloc", meaning: "Native macOS shortcut" },
  WINDOWS: { filename: "page.url", meaning: "Windows Internet Shortcut" },
  FREEDESKTOP: { filename: "page.desktop", meaning: "Linux desktop shortcut" },
};

export const setupShortcutOptions = () => {
  const notificationToggles = [
    "notifyOnSuccess",
    "notifyOnFailure",
    "notifyOnRuleMatch",
    "notifyOnLinkPreferred",
  ]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const notificationDuration = document.querySelector<HTMLInputElement>("#notifyDuration");
  const syncNotifications = () => {
    if (notificationDuration) {
      const enabled = notificationToggles.some(({ checked }) => checked);
      notificationDuration.disabled = !enabled;
      notificationDuration
        .closest(".notification-timing")
        ?.classList.toggle("is-disabled", !enabled);
    }
  };
  notificationToggles.forEach((toggle) => toggle.addEventListener("change", syncNotifications));

  const type = document.querySelector<HTMLSelectElement>("#shortcutType");
  const preview = document.querySelector<HTMLElement>("#shortcut-format-preview");
  const toggles = ["shortcutMedia", "shortcutLink", "shortcutPage", "shortcutTab"]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const syncFormat = () => {
    if (!type) return;
    const extension = (SHORTCUT_EXTENSIONS as Record<string, string>)[type.value] || "";
    const guidance = FORMAT_GUIDANCE[type.value];
    if (preview) {
      preview.textContent = guidance
        ? `${guidance.filename} · ${guidance.meaning}`
        : `page${extension || ".txt"}`;
    }
  };
  toggles.forEach((toggle) => toggle.addEventListener("change", syncFormat));
  type?.addEventListener("change", syncFormat);
  syncFormat();

  const combo = document.querySelector<HTMLInputElement>("#contentClickToSaveCombo");
  const storedButton = document.querySelector<HTMLInputElement>("#contentClickToSaveButton");
  const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier");
  const modifier2 = document.querySelector<HTMLSelectElement>("#clickToSaveModifier2");
  const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton");
  const apply = document.querySelector<HTMLButtonElement>("#clickToSaveApply");
  const reset = document.querySelector<HTMLButtonElement>("#clickToSaveReset");
  const status = document.querySelector<HTMLElement>("#clickToSaveStatus");
  const clickToSave = document.querySelector<HTMLInputElement>("#contentClickToSave");
  const warning = document.querySelector<HTMLElement>("#click-to-save-warning");
  const showClickCombo = () => {
    if (!combo || !modifier || !modifier2) return;
    const parts = combo.value.split("+").filter(Boolean);
    const known = new Set(["Alt", "Ctrl", "Shift", "Meta"]);
    const unknown = parts.find((part) => !known.has(part));
    if (button) button.value = storedButton?.value || "LEFT_CLICK";
    modifier.querySelector("[data-legacy]")?.remove();
    if (unknown || (parts.length === 1 && combo.value && !known.has(combo.value))) {
      const option = document.createElement("option");
      option.value = combo.value;
      option.textContent = `Legacy value: ${combo.value}`;
      option.dataset.legacy = "true";
      modifier.append(option);
      modifier.value = combo.value;
      modifier2.value = "";
      return;
    }
    modifier.value = parts[0] || "";
    modifier2.value = parts[1] || "";
  };
  const draftCombo = () => {
    if (!modifier || !modifier2) return "";
    if (modifier2.value === modifier.value) modifier2.value = "";
    return [modifier.value, modifier2.value].filter(Boolean).join("+");
  };
  const syncClickControls = () => {
    const changed =
      draftCombo() !== combo?.value || (button?.value || "") !== (storedButton?.value || "");
    if (apply) apply.disabled = !changed;
    if (status) status.textContent = changed ? "Ready to apply." : "";
    syncGestureWarning();
  };
  const syncGestureWarning = () => {
    if (!warning || !combo || !button) return;
    warning.hidden =
      !clickToSave?.checked || Boolean(draftCombo()) || button.value !== "LEFT_CLICK";
  };
  button?.addEventListener("change", syncClickControls);
  clickToSave?.addEventListener("change", syncGestureWarning);
  modifier?.addEventListener("change", syncClickControls);
  modifier2?.addEventListener("change", syncClickControls);
  apply?.addEventListener("click", () => {
    if (!combo || !storedButton || !button) return;
    combo.value = draftCombo();
    storedButton.value = button.value;
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    storedButton.dispatchEvent(new Event("change", { bubbles: true }));
    syncClickControls();
    if (status) status.textContent = "Shortcut updated.";
  });
  reset?.addEventListener("click", () => {
    if (!modifier || !modifier2 || !button) return;
    modifier.value = "Alt";
    modifier2.value = "";
    button.value = "LEFT_CLICK";
    apply?.click();
    if (status) status.textContent = "Shortcut reset.";
  });
  showClickCombo();
  syncClickControls();

  const accessInputs = ["keyRoot", "keyLastUsed"]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const accessStatus = document.querySelector<HTMLElement>("#access-key-status");
  const validateAccessKeys = () => {
    const invalid = accessInputs.find(({ value }) => value && !EFFECTIVE_ACCESS_KEY.test(value));
    accessInputs.forEach((input) =>
      input.toggleAttribute(
        "aria-invalid",
        Boolean(input.value && !EFFECTIVE_ACCESS_KEY.test(input.value)),
      ),
    );
    if (accessStatus) {
      accessStatus.textContent = invalid
        ? "Use one letter or number. Existing saved values remain supported until changed."
        : "";
    }
  };
  accessInputs.forEach((input) => input.addEventListener("input", validateAccessKeys));
  validateAccessKeys();

  document.addEventListener("options-restored", () => {
    syncNotifications();
    syncFormat();
    showClickCombo();
    syncClickControls();
    validateAccessKeys();
  });
  syncNotifications();
};
