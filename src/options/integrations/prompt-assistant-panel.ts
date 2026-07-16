import {
  promptAvailability,
  runPrompt,
  type PromptAvailability,
} from "../../platform/prompt-api.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { getMessage } from "../../platform/localization.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import type { WireIntegrationGrammar } from "../../shared/message-protocol.ts";
import { cssSelectorErrors } from "../core/css-selector-validation.ts";
import {
  applyRuleRequestGuardrails,
  buildRuleAuthoringPrompt,
  cleanRuleSuggestion,
  ruleRequestGuardrailIssues,
  type RuleAuthoringVocabulary,
} from "./prompt-assistant-model.ts";

type MessageSubstitutions = string | number | Array<string | number>;
type Localize = (key: string, substitutions?: MessageSubstitutions) => string;

type PromptAssistantPorts = {
  appendRule(textarea: HTMLTextAreaElement, rule: string): void;
};

const routingGrammar = async (): Promise<WireIntegrationGrammar> => {
  const response = await sendInternalMessage(webExtensionApi.runtime, {
    type: MESSAGE_TYPES.GET_GRAMMARS,
  });
  if (!("grammars" in response.body)) throw new Error("Routing grammar is unavailable");
  const grammar = response.body.grammars.find((candidate) => candidate.id === "routing");
  if (!grammar) throw new Error("Routing grammar is unavailable");
  return grammar;
};

const ruleAuthoringVocabulary = async (): Promise<RuleAuthoringVocabulary> => {
  const response = await sendInternalMessage(webExtensionApi.runtime, {
    type: MESSAGE_TYPES.GET_KEYWORDS,
  });
  if (!("matchers" in response.body)) throw new Error("Routing vocabulary is unavailable");
  return { matchers: response.body.matchers, variables: response.body.variables };
};

export const setupPromptAssistantPanel = (
  localize: Localize = getMessage,
  ports: PromptAssistantPorts,
): void => {
  const enabled = document.querySelector<HTMLInputElement>("#promptAssistantEnabled");
  const status = document.querySelector<HTMLElement>("#prompt-assistant-status");
  const form = document.querySelector<HTMLFormElement>("#prompt-assistant-form");
  const input = document.querySelector<HTMLTextAreaElement>("#prompt-assistant-input");
  const submit = document.querySelector<HTMLButtonElement>("#prompt-assistant-submit");
  const cancel = document.querySelector<HTMLButtonElement>("#prompt-assistant-cancel");
  const progress = document.querySelector<HTMLProgressElement>("#prompt-assistant-progress");
  const result = document.querySelector<HTMLElement>("#prompt-assistant-result");
  const rule = document.querySelector<HTMLElement>("#prompt-assistant-rule");
  const add = document.querySelector<HTMLButtonElement>("#prompt-assistant-add");
  const clear = document.querySelector<HTMLButtonElement>("#prompt-assistant-clear");
  if (
    !enabled ||
    !status ||
    !form ||
    !input ||
    !submit ||
    !cancel ||
    !progress ||
    !result ||
    !rule ||
    !add ||
    !clear
  ) {
    return;
  }

  let availability: PromptAvailability = "unavailable";
  let suggestedRule = "";
  let requestVersion = 0;
  let working = false;
  let activeController: AbortController | null = null;
  const copy = {
    off: localize("promptAssistantStatusOff") || "Off — no model checks or prompts",
    checking: localize("promptAssistantStatusChecking") || "Checking on-device model…",
    ready: localize("promptAssistantStatusReady") || "Ready on this device",
    downloadable:
      localize("promptAssistantStatusDownloadable") ||
      "The model downloads when you suggest your first rule",
    downloading:
      localize("promptAssistantStatusDownloading") || "Chrome is downloading the on-device model",
    unavailable:
      localize("promptAssistantStatusUnavailable") ||
      "Not available in this browser or on this device",
    working: localize("promptAssistantStatusWorking") || "Creating and checking a draft…",
    invalid: (error: string) =>
      localize("promptAssistantStatusInvalid", error) || `The draft needs another try: ${error}`,
    failed: (error: string) =>
      localize("promptAssistantStatusFailed", error) || `Could not create a draft: ${error}`,
    draftReady:
      localize("promptAssistantStatusDraftReady") || "Draft ready — review it before adding",
    added:
      localize("promptAssistantStatusAdded") || "Added as an unsaved draft in the rules editor",
  };

  const setStatus = (
    text: string,
    state: "off" | "checking" | "ready" | "notice" | "working" | "error" | "success",
  ) => {
    status.textContent = text;
    status.dataset.state = state;
  };

  const updateControls = () => {
    const active = enabled.checked;
    input.disabled = !active || working;
    submit.disabled =
      !active ||
      working ||
      !input.value.trim() ||
      (availability !== "available" && availability !== "downloadable");
    cancel.hidden = !working;
    cancel.disabled = !working;
    form.setAttribute("aria-busy", String(working));
  };

  const clearResult = () => {
    suggestedRule = "";
    rule.textContent = "";
    result.hidden = true;
    add.disabled = true;
  };

  const refreshAvailability = async () => {
    const version = ++requestVersion;
    if (!enabled.checked) {
      availability = "unavailable";
      setStatus(copy.off, "off");
      updateControls();
      return;
    }
    setStatus(copy.checking, "checking");
    updateControls();
    const nextAvailability = await promptAvailability();
    if (version !== requestVersion || !enabled.checked) return;
    availability = nextAvailability;
    if (availability === "available") setStatus(copy.ready, "ready");
    else if (availability === "downloadable") {
      setStatus(copy.downloadable, "notice");
    } else if (availability === "downloading") {
      setStatus(copy.downloading, "notice");
    } else setStatus(copy.unavailable, "error");
    updateControls();
  };

  const cancelCurrentRequest = () => {
    if (!working) return;
    requestVersion += 1;
    activeController?.abort();
    activeController = null;
    working = false;
    progress.hidden = true;
    progress.removeAttribute("value");
    if (availability === "available") setStatus(copy.ready, "ready");
    else if (availability === "downloadable") setStatus(copy.downloadable, "notice");
    else setStatus(copy.unavailable, "error");
    updateControls();
  };

  enabled.addEventListener("change", () => {
    cancelCurrentRequest();
    clearResult();
    void refreshAvailability();
  });
  input.addEventListener("input", updateControls);
  cancel.addEventListener("click", cancelCurrentRequest);
  clear.addEventListener("click", () => {
    clearResult();
    input.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const version = ++requestVersion;
    const controller = new AbortController();
    const request = input.value;
    activeController = controller;
    working = true;
    progress.hidden = true;
    progress.removeAttribute("value");
    clearResult();
    setStatus(copy.working, "working");
    updateControls();
    void Promise.all([routingGrammar(), ruleAuthoringVocabulary()])
      .then(([grammar, vocabulary]) => {
        if (version !== requestVersion || controller.signal.aborted) return null;
        return runPrompt(buildRuleAuthoringPrompt(request, grammar, vocabulary), {
          allowDownload: true,
          signal: controller.signal,
          onDownloadProgress: (loaded) => {
            if (version !== requestVersion || controller.signal.aborted) return;
            progress.hidden = false;
            if (loaded < 1) {
              progress.value = Math.max(0, loaded);
              setStatus(copy.downloading, "notice");
            } else {
              progress.removeAttribute("value");
              setStatus(copy.working, "working");
            }
          },
        });
      })
      .then(async (output) => {
        if (version !== requestVersion || !enabled.checked) return;
        const suggestion = output ? cleanRuleSuggestion(output) : null;
        if (!suggestion) throw new Error(copy.unavailable);
        const cleaned = applyRuleRequestGuardrails(request, suggestion);
        suggestedRule = cleaned;
        rule.textContent = cleaned;
        result.hidden = false;
        const invalidCss = cssSelectorErrors(cleaned)[0];
        if (invalidCss) {
          add.disabled = true;
          setStatus(copy.invalid(invalidCss.message), "error");
          return;
        }
        const response = await sendInternalMessage(webExtensionApi.runtime, {
          type: MESSAGE_TYPES.VALIDATE,
          body: { filenamePatterns: cleaned },
        });
        if (version !== requestVersion || !enabled.checked) return;
        if (!("version" in response.body)) throw new Error("Rule validation is unavailable");
        const invalid = response.body.ruleErrors?.find((error) => !error.warning);
        if (invalid) {
          add.disabled = true;
          setStatus(copy.invalid(invalid.message), "error");
          return;
        }
        const requestIssue = ruleRequestGuardrailIssues(request, cleaned)[0];
        if (requestIssue) {
          add.disabled = true;
          setStatus(copy.invalid(requestIssue), "error");
          return;
        }
        add.disabled = false;
        setStatus(copy.draftReady, "success");
      })
      .catch((error: unknown) => {
        if (version !== requestVersion || !enabled.checked) return;
        setStatus(copy.failed(String(error)), "error");
      })
      .finally(() => {
        if (version !== requestVersion) return;
        activeController = null;
        working = false;
        progress.hidden = true;
        progress.removeAttribute("value");
        updateControls();
      });
  });

  add.addEventListener("click", () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");
    if (!suggestedRule || !textarea || add.disabled) return;
    ports.appendRule(textarea, suggestedRule);
    add.disabled = true;
    setStatus(copy.added, "success");
    document.querySelector<HTMLButtonElement>("#tab-section-dynamic-downloads")?.click();
    document.querySelector<HTMLButtonElement>("#rules-mode-text")?.click();
    document.dispatchEvent(
      new CustomEvent("save-in:navigate-option", { detail: { target: textarea } }),
    );
  });

  if (enabled.checked) void refreshAvailability();
  else {
    setStatus(copy.off, "off");
    updateControls();
  }
};
