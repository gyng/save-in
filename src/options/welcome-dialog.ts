import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { preferredScrollBehavior } from "../shared/motion-preference.ts";
import { WELCOME_PENDING_STORAGE_KEY, WELCOME_VERSION } from "../shared/storage-keys.ts";

type Localize = (key: string) => string;
type WelcomeStorage = Pick<typeof webExtensionApi.storage.local, "get" | "remove">;
export type WelcomePresetApplier = (paths: string) => Promise<void>;
type WelcomeAction = "dismiss" | "customize" | "empty" | "permissions";

const EMPTY_PRESET_PATHS = ".";

const isWelcomeAction = (value: unknown): value is WelcomeAction =>
  value === "dismiss" || value === "customize" || value === "empty" || value === "permissions";

const createButton = (
  text: string,
  className: string,
  action: WelcomeAction,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.welcomeAction = action;
  button.textContent = text;
  return button;
};

const confirmEmptyPreset = (localize: Localize): Promise<boolean> =>
  new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog welcome-preset-confirm";
    dialog.setAttribute("aria-labelledby", "welcome-preset-confirm-title");
    dialog.setAttribute("aria-describedby", "welcome-preset-confirm-description");

    const title = document.createElement("h2");
    title.id = "welcome-preset-confirm-title";
    title.textContent = localize("welcomeEmptyConfirmTitle") || "Replace current folders?";
    const description = document.createElement("p");
    description.id = "welcome-preset-confirm-description";
    description.textContent =
      localize("welcomeEmptyConfirmDescription") ||
      "This replaces your current folder configuration and keeps only the browser Downloads destination.";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = localize("welcomeKeepCurrentFolders") || "Keep current folders";
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "button-danger danger-button";
    replace.textContent = localize("welcomeUseEmptyPreset") || "Use only the Downloads folder";
    actions.append(keep, replace);
    dialog.append(title, description, actions);
    document.body.append(dialog);

    const finish = (confirmed: boolean) => {
      dialog.remove();
      resolve(confirmed);
    };
    keep.addEventListener("click", () => finish(false));
    replace.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    keep.focus();
  });

const createWelcomeDialog = (localize: Localize): HTMLDialogElement => {
  const copy = {
    title: localize("welcomeTitle") || "Welcome to Save In",
    intro:
      localize("welcomeIntro") ||
      "Save In is ready. Use the right-click menu to save images, links, selected text, media, and pages into folders you choose.",
    stepRightClick: localize("welcomeStepRightClick") || "Right-click something you want to save.",
    stepChooseSaveIn: localize("welcomeStepChooseSaveIn") || "Choose Save In… from the menu.",
    stepPickFolder: localize("welcomeStepPickFolder") || "Pick a starter folder.",
    starterNote:
      localize("welcomeStarterNote") ||
      "Starter folders are active now. You can customize them at any time.",
    toolbarNote:
      localize("welcomeToolbarNote") ||
      "The toolbar button opens Page Sources for finding media on the current page.",
    permissions: localize("welcomePermissions") || "Why these permissions?",
    customize: localize("welcomeCustomizeFolders") || "Customize folders",
    empty: localize("welcomeUseEmptyPreset") || "Use only the Downloads folder",
    accept: localize("welcomeUseStarterFolders") || "Keep starter folders",
    emptyFailed:
      localize("welcomeEmptyPresetFailed") ||
      "Could not switch to only the Downloads folder. Your folders are unchanged.",
  };
  const dialog = document.createElement("dialog");
  dialog.id = "welcome-dialog";
  dialog.className = "app-dialog welcome-dialog";
  dialog.setAttribute("aria-labelledby", "welcome-title");
  dialog.setAttribute("aria-describedby", "welcome-intro");

  const shell = document.createElement("div");
  shell.className = "welcome-shell";

  const content = document.createElement("div");
  content.className = "welcome-content";

  const heading = document.createElement("div");
  heading.className = "welcome-heading";
  const icon = document.createElement("img");
  icon.className = "app-icon welcome-icon";
  icon.src = "../../icons/ic_archive_black_24px.svg";
  icon.alt = "";
  const headingCopy = document.createElement("div");
  const title = document.createElement("h1");
  title.id = "welcome-title";
  title.textContent = copy.title;
  headingCopy.append(title);
  heading.append(icon, headingCopy);

  const intro = document.createElement("p");
  intro.id = "welcome-intro";
  intro.className = "welcome-intro";
  intro.textContent = copy.intro;

  const steps = document.createElement("ol");
  steps.className = "welcome-steps";
  const stepMessages = [copy.stepRightClick, copy.stepChooseSaveIn, copy.stepPickFolder];
  for (const stepMessage of stepMessages) {
    const step = document.createElement("li");
    step.textContent = stepMessage;
    steps.append(step);
  }

  const notes = document.createElement("div");
  notes.className = "welcome-notes";
  const starterNote = document.createElement("p");
  starterNote.textContent = copy.starterNote;
  const toolbarNote = document.createElement("p");
  toolbarNote.textContent = copy.toolbarNote;
  notes.append(starterNote, toolbarNote);

  const footer = document.createElement("div");
  footer.className = "welcome-footer";
  const permissions = createButton(copy.permissions, "welcome-permissions", "permissions");
  const actions = document.createElement("div");
  actions.className = "welcome-actions";
  const customize = createButton(copy.customize, "welcome-customize", "customize");
  const empty = createButton(copy.empty, "welcome-empty", "empty");
  const accept = createButton(copy.accept, "button-primary welcome-accept", "dismiss");
  actions.append(customize, empty, accept);
  footer.append(permissions, actions);

  const actionStatus = document.createElement("p");
  actionStatus.className = "welcome-action-status feedback feedback-error";
  actionStatus.setAttribute("role", "alert");
  actionStatus.textContent = copy.emptyFailed;
  actionStatus.hidden = true;

  content.append(heading, intro, steps, notes, actionStatus, footer);
  shell.append(content);
  dialog.append(shell);
  return dialog;
};

const followWelcomeAction = (action: WelcomeAction): void => {
  if (action !== "customize") return;
  document.querySelector<HTMLButtonElement>("#paths-mode-visual")?.click();
  const firstPath = document.querySelector<HTMLInputElement>("#path-editor-rows .path-editor-dir");
  if (!firstPath) return;
  document.dispatchEvent(
    new CustomEvent("save-in:navigate-option", { detail: { target: firstPath } }),
  );
  if (!firstPath.closest(".tab-panel")) {
    firstPath.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
    firstPath.focus();
  }
};

const showPermissionExplanation = (welcomeDialog: HTMLDialogElement): void => {
  const aboutDialog = document.querySelector<HTMLDialogElement>("#about-dialog");
  if (!aboutDialog || aboutDialog.open || typeof aboutDialog.showModal !== "function") return;
  const returnFocus = welcomeDialog.querySelector<HTMLButtonElement>(".welcome-permissions");
  aboutDialog.addEventListener(
    "close",
    () => {
      if (welcomeDialog.isConnected && welcomeDialog.open) returnFocus?.focus();
    },
    { once: true },
  );
  aboutDialog.showModal();
};

export const showWelcomeDialog = (
  storage: WelcomeStorage = webExtensionApi.storage.local,
  localize: Localize = getMessage,
  isFirstInstall = false,
  applyPreset?: WelcomePresetApplier,
): boolean => {
  if (document.querySelector("#welcome-dialog")) return false;

  const dialog = createWelcomeDialog(localize);
  document.body.append(dialog);

  const savedStatus = document.querySelector<HTMLElement>("#lastSavedAt");
  if (savedStatus && isFirstInstall) {
    savedStatus.textContent = localize("welcomeUsingStarterSettings") || "Just now";
  }

  let finished = false;
  const finish = (action: WelcomeAction) => {
    if (finished) return;
    finished = true;
    dialog.remove();
    void storage.remove(WELCOME_PENDING_STORAGE_KEY).catch(() => {});
    followWelcomeAction(action);
  };
  const close = (action: WelcomeAction) => {
    if (typeof dialog.close === "function") dialog.close(action);
    else finish(action);
  };
  let applyingPreset = false;
  let choosingPreset = false;
  const setApplyingPreset = (applying: boolean) => {
    applyingPreset = applying;
    dialog.toggleAttribute("aria-busy", applying);
    dialog
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = applying));
  };
  const useEmptyPreset = async () => {
    if (applyingPreset || choosingPreset) return;
    choosingPreset = true;
    if (!isFirstInstall && !(await confirmEmptyPreset(localize))) {
      choosingPreset = false;
      return;
    }
    const status = dialog.querySelector<HTMLElement>(".welcome-action-status");
    if (status) status.hidden = true;
    setApplyingPreset(true);
    try {
      if (!applyPreset) throw new Error("Empty preset is unavailable");
      await applyPreset(EMPTY_PRESET_PATHS);
      close("empty");
    } catch {
      if (status) status.hidden = false;
      setApplyingPreset(false);
      choosingPreset = false;
    }
  };

  dialog.addEventListener("click", (event) => {
    const actionTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-welcome-action]")
        : null;
    const action = actionTarget?.dataset.welcomeAction;
    if (action === "permissions") showPermissionExplanation(dialog);
    else if (action === "empty") void useEmptyPreset();
    else if (isWelcomeAction(action)) close(action);
    else if (event.target === dialog && !applyingPreset) close("dismiss");
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!applyingPreset) close("dismiss");
  });
  dialog.addEventListener("close", () =>
    finish(isWelcomeAction(dialog.returnValue) ? dialog.returnValue : "dismiss"),
  );

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.querySelector<HTMLButtonElement>(".welcome-accept")?.focus();
  return true;
};

export const setupWelcomeDialog = async (
  storage: WelcomeStorage = webExtensionApi.storage.local,
  localize: Localize = getMessage,
  applyPreset?: WelcomePresetApplier,
): Promise<boolean> => {
  const stored = await storage.get(WELCOME_PENDING_STORAGE_KEY).catch(() => ({}));
  if (Reflect.get(stored, WELCOME_PENDING_STORAGE_KEY) !== WELCOME_VERSION) return false;
  return showWelcomeDialog(storage, localize, true, applyPreset);
};
