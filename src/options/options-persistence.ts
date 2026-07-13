import type { WireOptionSchemaKey } from "../shared/message-protocol.ts";
import type {
  ApplyConfigResponse,
  SuccessfulApplyConfigResponse,
} from "../shared/message-protocol.ts";

export type JsonRecord = Record<string, unknown>;

export type OptionSchema = {
  keys: Array<JsonRecord & WireOptionSchemaKey>;
  types: { BOOL: string; VALUE: string };
};

export type SavedChange = { name: string; before: unknown; after: unknown };

type OptionsPersistencePorts = {
  getSchema(): Promise<OptionSchema>;
  getStored(keys: string[]): Promise<JsonRecord>;
  apply(config: JsonRecord, expected?: JsonRecord): Promise<ApplyConfigResponse>;
  collect(schema: OptionSchema, scope?: string): JsonRecord;
  assertApplied(response: unknown): SuccessfulApplyConfigResponse;
  markSaved(changes?: SavedChange[], undo?: () => Promise<void>): void;
  assertUndoSafe(): void;
  onRestore(values: JsonRecord, schema: OptionSchema): void;
};

export const createOptionsPersistence = (ports: OptionsPersistencePorts) => {
  const lastKnown: JsonRecord = {};

  const restore = async (): Promise<void> => {
    const schema = await ports.getSchema();
    const stored = await ports.getStored(schema.keys.map(({ name }) => name));
    schema.keys.forEach((option) => {
      lastKnown[option.name] =
        typeof stored[option.name] === "undefined" ? option.default : stored[option.name];
    });
    ports.onRestore(stored, schema);
  };

  const save = async (scope?: string, scopeValue?: unknown): Promise<unknown> => {
    const schema = await ports.getSchema();
    const config = ports.collect(schema, scope);
    if (scope && typeof scopeValue !== "undefined") config[scope] = scopeValue;
    const previous = Object.fromEntries(Object.keys(config).map((name) => [name, lastKnown[name]]));

    const response = await ports.apply(config, undefined);
    const applied = ports.assertApplied(response).body.applied;
    const changes: SavedChange[] = Object.entries(applied)
      .filter(([name, value]) => JSON.stringify(previous[name]) !== JSON.stringify(value))
      .map(([name, after]) => ({ name, before: previous[name], after }));
    Object.assign(lastKnown, applied);

    ports.markSaved(changes, async () => {
      ports.assertUndoSafe();
      const undoConfig = Object.fromEntries(changes.map(({ name, before }) => [name, before]));
      const expected = Object.fromEntries(changes.map(({ name, after }) => [name, after]));
      const undoResponse = await ports.apply(undoConfig, expected);
      ports.assertApplied(undoResponse);
      Object.assign(lastKnown, undoConfig);
      await restore();
      ports.markSaved();
    });
    return response;
  };

  return { lastKnown, restore, save };
};
