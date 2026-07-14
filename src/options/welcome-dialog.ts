import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WELCOME_PENDING_STORAGE_KEY, WELCOME_VERSION } from "../shared/storage-keys.ts";

type Localize = (key: string) => string;
type WelcomeStorage = Pick<typeof webExtensionApi.storage.local, "get" | "remove">;
type WelcomeAction = "dismiss" | "customize" | "permissions";

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

const createWelcomeDialog = (localize: Localize): HTMLDialogElement => {
  const copy = {
    ready: localize("welcomeReady") || "Ready to save",
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
    accept: localize("welcomeUseStarterFolders") || "Use starter folders",
  };
  const dialog = document.createElement("dialog");
  dialog.id = "welcome-dialog";
  dialog.className = "app-dialog welcome-dialog";
  dialog.setAttribute("aria-labelledby", "welcome-title");
  dialog.setAttribute("aria-describedby", "welcome-intro");

  const shell = document.createElement("div");
  shell.className = "welcome-shell";

  const accent = document.createElement("div");
  accent.className = "welcome-accent";
  accent.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "welcome-content";

  const heading = document.createElement("div");
  heading.className = "welcome-heading";
  const icon = document.createElement("img");
  icon.className = "welcome-icon";
  icon.src = "../../icons/ic_archive_black_48px.png";
  icon.alt = "";
  const headingCopy = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "welcome-kicker";
  kicker.textContent = copy.ready;
  const title = document.createElement("h1");
  title.id = "welcome-title";
  title.textContent = copy.title;
  headingCopy.append(kicker, title);
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
  const accept = createButton(copy.accept, "button-primary welcome-accept", "dismiss");
  actions.append(customize, accept);
  footer.append(permissions, actions);

  content.append(heading, intro, steps, notes, footer);
  shell.append(accent, content);
  dialog.append(shell);
  return dialog;
};

const followWelcomeAction = (action: WelcomeAction): void => {
  if (action === "permissions") {
    document.querySelector<HTMLButtonElement>("#about-open")?.click();
    return;
  }
  if (action !== "customize") return;
  document.querySelector<HTMLButtonElement>("#paths-mode-visual")?.click();
  const firstPath = document.querySelector<HTMLInputElement>("#path-editor-rows .path-editor-dir");
  firstPath?.scrollIntoView({ block: "center", behavior: "smooth" });
  firstPath?.focus();
};

export const setupWelcomeDialog = async (
  storage: WelcomeStorage = webExtensionApi.storage.local,
  localize: Localize = getMessage,
): Promise<boolean> => {
  const stored = await storage.get(WELCOME_PENDING_STORAGE_KEY).catch(() => ({}));
  if (Reflect.get(stored, WELCOME_PENDING_STORAGE_KEY) !== WELCOME_VERSION) return false;

  const dialog = createWelcomeDialog(localize);
  document.body.append(dialog);

  const savedStatus = document.querySelector<HTMLElement>("#lastSavedAt");
  if (savedStatus) {
    savedStatus.textContent = localize("welcomeUsingStarterSettings") || "Using starter settings";
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

  dialog.addEventListener("click", (event) => {
    const actionTarget = (event.target as Element).closest<HTMLButtonElement>(
      "[data-welcome-action]",
    );
    const action = actionTarget?.dataset.welcomeAction as WelcomeAction | undefined;
    if (action) close(action);
    else if (event.target === dialog) close("dismiss");
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close("dismiss");
  });
  dialog.addEventListener("close", () => finish(dialog.returnValue as WelcomeAction));

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.querySelector<HTMLButtonElement>(".welcome-accept")?.focus();
  return true;
};
