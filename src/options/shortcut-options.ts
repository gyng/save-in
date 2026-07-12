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
  const button = document.querySelector<HTMLSelectElement>("#contentClickToSaveButton");
  const clickToSave = document.querySelector<HTMLInputElement>("#contentClickToSave");
  const warning = document.querySelector<HTMLElement>("#click-to-save-warning");
  const syncGestureWarning = () => {
    if (!warning || !combo || !button) return;
    warning.hidden =
      !clickToSave?.checked || Boolean(combo.value.trim()) || button.value !== "LEFT_CLICK";
  };
  combo?.addEventListener("input", syncGestureWarning);
  combo?.addEventListener("change", syncGestureWarning);
  button?.addEventListener("change", syncGestureWarning);
  clickToSave?.addEventListener("change", syncGestureWarning);
  syncGestureWarning();

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
    syncGestureWarning();
    validateAccessKeys();
  });
  syncNotifications();
};
