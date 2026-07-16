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
  ruleCritiqueConstraint,
  rulePlanConstraint,
  assembleRule,
  buildRuleCritiquePrompt,
  buildRulePlanPrompt,
  describesSameRule,
  isSingleRuleSuggestion,
  parseRuleCritique,
  parseRulePlan,
  ruleRequestGuardrailIssues,
  type RuleAuthoringVocabulary,
} from "./prompt-assistant-model.ts";

type MessageSubstitutions = string | number | Array<string | number>;
type Localize = (key: string, substitutions?: MessageSubstitutions) => string;

type PromptAssistantPorts = {
  appendRule(textarea: HTMLTextAreaElement, rule: string): void;
};

const AVAILABILITY_RECHECK_MS = 1_000;

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
  let availabilityTimer: ReturnType<typeof setTimeout> | undefined;
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
    unusable: localize("promptAssistantStatusUnusable") || "The model did not return a usable rule",
    unusableReview:
      localize("promptAssistantStatusUnusableReview") ||
      "The model did not finish checking the draft",
    working: localize("promptAssistantStatusWorking") || "Creating and checking a draft…",
    invalid: (error: string) =>
      localize("promptAssistantStatusInvalid", error) || `The draft needs another try: ${error}`,
    singleRule: localize("promptAssistantSingleRule") || "The draft must contain exactly one rule",
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

  const showCandidate = (candidate: string) => {
    suggestedRule = candidate;
    rule.textContent = candidate;
    result.hidden = false;
  };

  const validationIssues = async (request: string, candidate: string): Promise<string[]> => {
    const issues = ruleRequestGuardrailIssues(request, candidate);
    // Kept so a candidate from any future non-plan source is checked, not trusted.
    /* v8 ignore next -- assembleRule emits one rule by construction: every plan field reaching the text rejects \p{Cc}, so none can open a second rule. */
    if (!isSingleRuleSuggestion(candidate)) return [copy.singleRule, ...issues];
    const invalidCss = cssSelectorErrors(candidate)[0];
    if (invalidCss) return [...issues, invalidCss.message];
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.VALIDATE,
      body: { filenamePatterns: candidate },
    });
    if (!("version" in response.body)) throw new Error("Rule validation is unavailable");
    return [
      ...issues,
      ...(response.body.ruleErrors ?? [])
        .filter((error) => !error.warning)
        .map((error) => error.message),
    ];
  };

  const refreshAvailability = async () => {
    if (availabilityTimer) {
      clearTimeout(availabilityTimer);
      availabilityTimer = undefined;
    }
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
      availabilityTimer = setTimeout(() => {
        availabilityTimer = undefined;
        void refreshAvailability();
      }, AVAILABILITY_RECHECK_MS);
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
    if (availability === "downloadable") setStatus(copy.downloadable, "notice");
    else setStatus(copy.ready, "ready");
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
    const isCurrent = () =>
      version === requestVersion && enabled.checked && !controller.signal.aborted;
    void (async () => {
      const [grammar, vocabulary] = await Promise.all([
        routingGrammar(),
        ruleAuthoringVocabulary(),
      ]);
      if (!isCurrent()) return;
      // The model reports the facts of the request; the rule text is assembled
      // here. A small on-device model honours a response schema reliably and
      // spells the routing grammar unreliably, so nothing it returns is syntax.
      const authorOutput = await runPrompt(buildRulePlanPrompt(request), {
        allowDownload: true,
        signal: controller.signal,
        responseConstraint: rulePlanConstraint(request),
        onDownloadProgress: (loaded) => {
          if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      const plan = authorOutput ? parseRulePlan(authorOutput) : null;
      let candidate = plan ? assembleRule(plan) : null;
      if (!candidate) throw new Error(copy.unusable);

      let issues = await validationIssues(request, candidate);
      if (!isCurrent()) return;
      const critiqueOutput = await runPrompt(
        buildRuleCritiquePrompt(request, candidate, issues, grammar, vocabulary),
        {
          allowDownload: true,
          signal: controller.signal,
          responseConstraint: ruleCritiqueConstraint(request),
        },
      );
      if (!isCurrent()) return;
      const critique = critiqueOutput ? parseRuleCritique(critiqueOutput) : null;
      if (!critique) throw new Error(copy.unusableReview);
      // The reviewer's repair is a plan too, so agreement is decided on the rule
      // its plan assembles to, not on how it retyped one. Measured: it answers
      // "accepted" and then hands back a plan naming the folder as the site, so
      // an approval is read as an approval of the candidate — its repair is what
      // it offers when it declines, and only then.
      const critiqueRule = assembleRule(critique.repairedPlan);
      if (issues.length === 0 && critique.accepted) {
        showCandidate(candidate);
        add.disabled = false;
        setStatus(copy.draftReady, "success");
        return;
      }

      const repaired = critiqueRule;
      if (!repaired) throw new Error(copy.unusable);
      candidate = repaired;
      issues = await validationIssues(request, candidate);
      if (!isCurrent()) return;
      const finalReviewOutput = await runPrompt(
        buildRuleCritiquePrompt(request, candidate, issues, grammar, vocabulary),
        {
          allowDownload: true,
          signal: controller.signal,
          responseConstraint: ruleCritiqueConstraint(request),
        },
      );
      if (!isCurrent()) return;
      const finalReview = finalReviewOutput ? parseRuleCritique(finalReviewOutput) : null;
      if (!finalReview) throw new Error(copy.unusableReview);
      showCandidate(candidate);
      const finalReviewRule = assembleRule(finalReview.repairedPlan);
      if (
        issues.length === 0 &&
        finalReview.accepted &&
        finalReviewRule !== null &&
        describesSameRule(candidate, finalReviewRule)
      ) {
        add.disabled = false;
        setStatus(copy.draftReady, "success");
        return;
      }
      add.disabled = true;
      const problem = issues[0] ?? finalReview.issues[0] ?? critique.issues[0];
      setStatus(copy.invalid(problem || "The draft does not match the request"), "error");
    })()
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
