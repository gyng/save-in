import { isStringKeyedRecord } from "../shared/message-protocol.ts";

type OptionSchema = { keys: Array<{ name: string }> };

type SettingsTransferDependencies = {
  getSchema: () => Promise<OptionSchema>;
  getStored: (keys: string[]) => Promise<Record<string, unknown>>;
  apply: (config: Record<string, unknown>) => Promise<unknown>;
  restore: () => void;
};

export const setupSettingsTransfer = (dependencies: SettingsTransferDependencies) => {
  document.querySelector("#settings-export")?.addEventListener("click", () => {
    void dependencies.getSchema().then(async (schema) => {
      const loaded = await dependencies.getStored(schema.keys.map(({ name }) => name));
      const output = document.querySelector("#export-target");
      if (output instanceof HTMLTextAreaElement) {
        output.hidden = false;
        output.value = JSON.stringify(loaded, null, 2);
      }
    });
  });

  document.querySelector("#settings-import")?.addEventListener("click", () => {
    void dependencies.getSchema().then(async () => {
      const json = window.prompt("Paste settings to import");
      if (!json) return;
      try {
        const settings: unknown = JSON.parse(json);
        if (!isStringKeyedRecord(settings)) throw new TypeError("Settings must be a JSON object");
        const response = await dependencies.apply(settings);
        dependencies.restore();
        const body =
          isStringKeyedRecord(response) && isStringKeyedRecord(response.body)
            ? response.body
            : undefined;
        const rejected = body?.rejected;
        window.alert(
          Array.isArray(rejected) && rejected.length > 0
            ? `Settings loaded with ${rejected.length} rejected value(s).`
            : "Settings loaded.",
        );
      } catch (error) {
        window.alert(`Failed to load settings ${error}`);
      }
    });
  });
};
