import type { WireOptionSchemaKey } from "../../shared/message-protocol.ts";
import type {
  ApplyConfigResponse,
  SuccessfulApplyConfigResponse,
} from "../../shared/message-protocol.ts";
import { getMessage } from "../../platform/localization.ts";

export type JsonRecord = Record<string, unknown>;

export type OptionSchema = {
  keys: WireOptionSchemaKey[];
  types: { BOOL: string; VALUE: string };
};

export type SavedChange = { name: string; before: unknown; after: unknown };

export const OPTIONS_SAVE_CANCELLED = Object.freeze({ cancelled: true as const });

type OptionsPersistencePorts = {
  getSchema(): Promise<OptionSchema>;
  getStored(keys: string[]): Promise<JsonRecord>;
  apply(config: JsonRecord, expected?: JsonRecord): Promise<ApplyConfigResponse>;
  collect(schema: OptionSchema, scope?: string): JsonRecord;
  assertApplied(response: unknown): SuccessfulApplyConfigResponse;
  markSaved(changes?: SavedChange[], undo?: () => Promise<void>): void;
  assertUndoSafe(): void;
  onRestore(values: JsonRecord, schema: OptionSchema): void;
  confirmChanges?(changes: SavedChange[]): Promise<boolean>;
  onDecline?(values: JsonRecord, schema: OptionSchema): void;
};

export const createOptionsPersistence = (ports: OptionsPersistencePorts) => {
  const lastKnown: JsonRecord = {};
  let activeRestore: Promise<void> | null = null;

  const hydrateKnownValues = async (schema: OptionSchema, names: string[]): Promise<void> => {
    const missing = names.filter((name) => !Object.hasOwn(lastKnown, name));
    if (missing.length === 0) return;
    const stored = await ports.getStored(missing);
    missing.forEach((name) => {
      const option = schema.keys.find((candidate) => candidate.name === name);
      lastKnown[name] = typeof stored[name] === "undefined" ? option?.default : stored[name];
    });
  };

  const restore = (): Promise<void> => {
    if (activeRestore) return activeRestore;
    const task = (async () => {
      const schema = await ports.getSchema();
      const stored = await ports.getStored(schema.keys.map(({ name }) => name));
      schema.keys.forEach((option) => {
        lastKnown[option.name] =
          typeof stored[option.name] === "undefined" ? option.default : stored[option.name];
      });
      ports.onRestore(stored, schema);
    })();
    activeRestore = task;
    void task.then(
      () => {
        activeRestore = null;
      },
      () => {
        activeRestore = null;
      },
    );
    return task;
  };

  const save = async (scope?: string, scopeValue?: unknown): Promise<unknown> => {
    await activeRestore;
    const schema = await ports.getSchema();
    const config = ports.collect(schema, scope);
    if (scope && typeof scopeValue !== "undefined") config[scope] = scopeValue;
    await hydrateKnownValues(schema, Object.keys(config));
    const previous = Object.fromEntries(Object.keys(config).map((name) => [name, lastKnown[name]]));
    const proposedChanges: SavedChange[] = Object.entries(config)
      .filter(([name, value]) => JSON.stringify(previous[name]) !== JSON.stringify(value))
      .map(([name, after]) => ({ name, before: previous[name], after }));

    if (ports.confirmChanges && !(await ports.confirmChanges(proposedChanges))) {
      ports.onDecline?.(previous, schema);
      return OPTIONS_SAVE_CANCELLED;
    }

    const response = await ports.apply(config, undefined);
    const applied = ports.assertApplied(response).body.applied;
    const changes: SavedChange[] = Object.entries(applied)
      .filter(([name, value]) => JSON.stringify(previous[name]) !== JSON.stringify(value))
      .map(([name, after]) => ({ name, before: previous[name], after }));
    Object.assign(lastKnown, applied);

    ports.markSaved(changes, async () => {
      ports.assertUndoSafe();
      // The undo itself is a config change (it applies `before` over `after`)
      // and can be just as destructive as the save it reverses — e.g.
      // undoing a History retention raise re-lowers the limit and prunes.
      // Gate it through the same confirmation the forward save used, on the
      // reversed changes.
      if (ports.confirmChanges) {
        const reverted: SavedChange[] = changes.map(({ name, before, after }) => ({
          name,
          before: after,
          after: before,
        }));
        if (!(await ports.confirmChanges(reverted))) {
          throw new Error(getMessage("savedUndoDeclined") || "Undo canceled");
        }
      }
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

  const acceptExternal = (applied: JsonRecord): SavedChange[] => {
    const changes = Object.entries(applied)
      .filter(([name, after]) => JSON.stringify(lastKnown[name]) !== JSON.stringify(after))
      .map(([name, after]) => ({ name, before: lastKnown[name], after }));
    Object.assign(lastKnown, applied);
    return changes;
  };

  return { lastKnown, restore, save, acceptExternal };
};
