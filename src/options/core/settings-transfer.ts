import type { ApplyConfigResponse } from "../../shared/message-protocol.ts";
import { isStringKeyedRecord } from "../../shared/message-protocol.ts";
import { assertApplyAcknowledged } from "./options-save.ts";

type OptionSchema = { keys: Array<{ name: string }> };

type SettingsTransferDependencies = {
  getSchema: () => Promise<OptionSchema>;
  getStored: (keys: string[]) => Promise<Record<string, unknown>>;
  apply: (config: Record<string, unknown>) => Promise<ApplyConfigResponse>;
  restore: () => Promise<void>;
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
      const response = assertApplyAcknowledged(await dependencies.apply(settings));
      await dependencies.restore();
      const rejected = response.body.rejected;
      window.alert(
        rejected.length > 0
          ? `Settings loaded with ${rejected.length} rejected value(s).`
          : "Settings loaded.",
      );
    });
  });
};
