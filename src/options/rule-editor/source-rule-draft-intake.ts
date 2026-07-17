import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { SOURCE_RULE_DRAFT_SESSION_KEY } from "../../shared/storage-keys.ts";
import { isStringKeyedRecord } from "../../shared/util.ts";
import { appendRule } from "./rule-builder.ts";
import { createSerialQueue } from "../../shared/serial-queue.ts";

const readDraft = async (): Promise<string | null> => {
  const areas = webExtensionApi.storage.session
    ? [webExtensionApi.storage.session, webExtensionApi.storage.local]
    : [webExtensionApi.storage.local];
  for (const area of areas) {
    try {
      const stored = (await area.get(SOURCE_RULE_DRAFT_SESSION_KEY))[SOURCE_RULE_DRAFT_SESSION_KEY];
      await area.remove(SOURCE_RULE_DRAFT_SESSION_KEY);
      if (isStringKeyedRecord(stored) && typeof stored.rule === "string" && stored.rule.trim()) {
        return stored.rule;
      }
    } catch {
      // Try the compatibility storage area when this host lacks storage.session.
    }
  }
  return null;
};

const consumeSourceRuleDraft = async (): Promise<boolean> => {
  const rule = await readDraft();
  if (!rule) return false;
  const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");
  if (!textarea) return false;
  document.querySelector<HTMLButtonElement>("#tab-section-dynamic-downloads")?.click();
  appendRule(textarea, rule);
  document.querySelector<HTMLButtonElement>("#rules-mode-visual")?.click();
  document.dispatchEvent(
    new CustomEvent("save-in:navigate-option", { detail: { target: textarea } }),
  );
  return true;
};

const sourceRuleDraftQueue = createSerialQueue();
export const applySourceRuleDraft = (): Promise<boolean> =>
  sourceRuleDraftQueue.enqueue(consumeSourceRuleDraft);

let listenerInstalled = false;
export const setupSourceRuleDraft = (): void => {
  if (listenerInstalled) return;
  listenerInstalled = true;
  webExtensionApi.storage.onChanged.addListener((changes) => {
    if (!Object.hasOwn(changes, SOURCE_RULE_DRAFT_SESSION_KEY)) return;
    void applySourceRuleDraft();
  });
};
