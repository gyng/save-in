import type { ApplyConfigResponse } from "../../shared/message-protocol.ts";
import { isStringKeyedRecord } from "../../shared/message-protocol.ts";
import { assertApplyAcknowledged } from "./options-save.ts";
import { cssSelectorErrors } from "./css-selector-validation.ts";
import type { SavedChange } from "./options-persistence.ts";
import { lowersHistoryRetention } from "../history/history-retention-model.ts";

type OptionSchema = { keys: Array<{ name: string }> };

type SettingsTransferDependencies = {
  getSchema: () => Promise<OptionSchema>;
  getStored: (keys: string[]) => Promise<Record<string, unknown>>;
  apply: (config: Record<string, unknown>) => Promise<ApplyConfigResponse>;
  restore: () => Promise<void>;
  // Shared with the autosave boundary (options.ts) so declining a History
  // retention lowering behaves the same wherever it can be triggered. Left
  // unwired, a lowering is treated as declined rather than silently applied.
  confirmChanges?: (changes: SavedChange[]) => Promise<boolean>;
  // Called after a successful apply that included a confirmed retention
  // lowering, so History drops the rows storage already pruned.
  onHistoryRetentionLowered?: () => void;
};

export const setupSettingsTransfer = (dependencies: SettingsTransferDependencies) => {
  const run = (action: "export" | "load", task: () => Promise<void>): void => {
    void task().catch((error) => window.alert(`Failed to ${action} settings ${error}`));
  };

  document.querySelector("#settings-export")?.addEventListener("click", () => {
    run("export", async () => {
      const schema = await dependencies.getSchema();
      const loaded = await dependencies.getStored(schema.keys.map(({ name }) => name));
      const output = document.querySelector("#export-target");
      if (output instanceof HTMLTextAreaElement) {
        output.hidden = false;
        output.value = JSON.stringify(loaded, null, 2);
      }
    });
  });

  document.querySelector("#settings-import")?.addEventListener("click", () => {
    run("load", async () => {
      await dependencies.getSchema();
      const json = window.prompt("Paste settings to import");
      if (!json) return;
      const settings: unknown = JSON.parse(json);
      if (!isStringKeyedRecord(settings)) throw new TypeError("Settings must be a JSON object");
      if (
        typeof settings.contentClickToSaveBindings === "undefined" &&
        (typeof settings.contentClickToSaveCombo !== "undefined" ||
          typeof settings.contentClickToSaveButton !== "undefined")
      ) {
        // An older export must keep controlling click-to-save when imported
        // over a profile that already has the versioned gesture option.
        settings.contentClickToSaveBindings = "";
      }
      if (typeof settings.filenamePatterns === "string") {
        const invalidCss = cssSelectorErrors(settings.filenamePatterns)[0];
        if (invalidCss) throw new TypeError(`${invalidCss.message}: ${invalidCss.error}`);
      }

      // An imported historyRetentionLimit lower than what's stored would
      // otherwise reach APPLY_CONFIG unconfirmed and silently prune older
      // completed entries. Declining keeps every other imported setting —
      // only the retention limit itself is left at its current value.
      let confirmedRetentionLowering = false;
      if (Object.hasOwn(settings, "historyRetentionLimit")) {
        const stored = await dependencies.getStored(["historyRetentionLimit"]);
        const changes: SavedChange[] = [
          {
            name: "historyRetentionLimit",
            before: stored.historyRetentionLimit,
            after: settings.historyRetentionLimit,
          },
        ];
        if (lowersHistoryRetention(changes)) {
          if (dependencies.confirmChanges && (await dependencies.confirmChanges(changes))) {
            confirmedRetentionLowering = true;
          } else {
            delete settings.historyRetentionLimit;
          }
        }
      }

      const response = assertApplyAcknowledged(await dependencies.apply(settings));
      await dependencies.restore();
      if (confirmedRetentionLowering) dependencies.onHistoryRetentionLowered?.();
      const rejected = response.body.rejected;
      window.alert(
        rejected.length > 0
          ? `Settings loaded with ${rejected.length} rejected value(s).`
          : "Settings loaded.",
      );
    });
  });
};
