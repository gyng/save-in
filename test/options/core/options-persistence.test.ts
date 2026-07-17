import { createOptionsPersistence } from "../../../src/options/core/options-persistence.ts";
import { assertApplySucceeded } from "../../../src/options/core/options-save.ts";

const schema = {
  keys: [
    { name: "paths", type: "VALUE", default: "." },
    { name: "links", type: "BOOL", default: true },
  ],
  types: { BOOL: "BOOL", VALUE: "VALUE" },
};

const acknowledgement = (applied: Record<string, unknown>) => ({
  type: "APPLY_CONFIG_RESULT" as const,
  body: { version: 1, applied, rejected: [] },
});

describe("options persistence", () => {
  test("restores schema keys and updates the known persisted snapshot", async () => {
    const onRestore = vi.fn();
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(() => Promise.resolve({ paths: "images" })),
      apply: vi.fn(async () => acknowledgement({})),
      collect: vi.fn(),
      assertApplied: assertApplySucceeded,
      markSaved: vi.fn(),
      assertUndoSafe: vi.fn(),
      onRestore,
    });

    await persistence.restore();

    expect(onRestore).toHaveBeenCalledWith({ paths: "images" }, schema);
    expect(persistence.lastKnown).toEqual({ paths: "images", links: true });
  });

  test("saves applied values and undoes with an atomic expected snapshot", async () => {
    let undo: (() => Promise<void>) | undefined;
    const apply = vi
      .fn()
      .mockResolvedValueOnce(acknowledgement({ paths: "images" }))
      .mockResolvedValueOnce(acknowledgement({ paths: "." }));
    const markSaved = vi.fn((_changes, callback?: () => Promise<void>) => {
      undo = callback;
    });
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(() => Promise.resolve({ paths: ".", links: true })),
      apply,
      collect: vi.fn(() => ({ paths: "images" })),
      assertApplied: assertApplySucceeded,
      markSaved,
      assertUndoSafe: vi.fn(),
      onRestore: vi.fn(),
    });
    await persistence.restore();

    await persistence.save("paths", "images");
    await undo?.();

    expect(apply).toHaveBeenNthCalledWith(1, { paths: "images" }, undefined);
    expect(apply).toHaveBeenNthCalledWith(2, { paths: "." }, { paths: "images" });
    expect(persistence.lastKnown.paths).toBe(".");
  });

  test("adopts externally applied values and reports changes from the known snapshot", async () => {
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(() => Promise.resolve({ paths: ".", links: true })),
      apply: vi.fn(async () => acknowledgement({})),
      collect: vi.fn(),
      assertApplied: assertApplySucceeded,
      markSaved: vi.fn(),
      assertUndoSafe: vi.fn(),
      onRestore: vi.fn(),
    });
    await persistence.restore();

    expect(persistence.acceptExternal({ paths: "agent", links: false })).toEqual([
      { name: "paths", before: ".", after: "agent" },
      { name: "links", before: true, after: false },
    ]);
    expect(persistence.lastKnown).toEqual({ paths: "agent", links: false });
  });

  test("captures a scoped value before asynchronous schema resolution", async () => {
    let resolveSchema!: (value: typeof schema) => void;
    const schemaReady = new Promise<typeof schema>((resolve) => {
      resolveSchema = resolve;
    });
    const apply = vi.fn(() => Promise.resolve(acknowledgement({ paths: "captured" })));
    const persistence = createOptionsPersistence({
      getSchema: () => schemaReady,
      getStored: vi.fn(),
      apply,
      collect: vi.fn(() => ({ paths: "later-dom-value" })),
      assertApplied: assertApplySucceeded,
      markSaved: vi.fn(),
      assertUndoSafe: vi.fn(),
      onRestore: vi.fn(),
    });

    const saving = persistence.save("paths", "captured");
    resolveSchema(schema);
    await saving;

    expect(apply).toHaveBeenCalledWith({ paths: "captured" }, undefined);
  });

  test("saves a collected configuration without a field scope", async () => {
    const apply = vi.fn(() => Promise.resolve(acknowledgement({ links: false })));
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(),
      apply,
      collect: vi.fn(() => ({ links: false })),
      assertApplied: assertApplySucceeded,
      markSaved: vi.fn(),
      assertUndoSafe: vi.fn(),
      onRestore: vi.fn(),
    });

    await persistence.save();

    expect(apply).toHaveBeenCalledWith({ links: false }, undefined);
    expect(persistence.lastKnown.links).toBe(false);
  });
});
