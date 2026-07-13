import { createOptionsPersistence } from "../src/options/options-persistence.ts";

const schema = {
  keys: [
    { name: "paths", type: "VALUE", default: "." },
    { name: "links", type: "BOOL", default: true },
  ],
  types: { BOOL: "BOOL", VALUE: "VALUE" },
};

describe("options persistence", () => {
  test("restores schema keys and updates the known persisted snapshot", async () => {
    const onRestore = vi.fn();
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(() => Promise.resolve({ paths: "images" })),
      apply: vi.fn(),
      collect: vi.fn(),
      assertApplied: vi.fn(),
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
      .mockResolvedValueOnce({ body: { applied: { paths: "images" } } })
      .mockResolvedValueOnce({ body: { applied: { paths: "." } } });
    const markSaved = vi.fn((_changes, callback?: () => Promise<void>) => {
      undo = callback;
    });
    const persistence = createOptionsPersistence({
      getSchema: () => Promise.resolve(schema),
      getStored: vi.fn(() => Promise.resolve({ paths: ".", links: true })),
      apply,
      collect: vi.fn(() => ({ paths: "images" })),
      assertApplied: vi.fn(),
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

  test("captures a scoped value before asynchronous schema resolution", async () => {
    let resolveSchema!: (value: typeof schema) => void;
    const schemaReady = new Promise<typeof schema>((resolve) => {
      resolveSchema = resolve;
    });
    const apply = vi.fn(() => Promise.resolve({ body: { applied: { paths: "captured" } } }));
    const persistence = createOptionsPersistence({
      getSchema: () => schemaReady,
      getStored: vi.fn(),
      apply,
      collect: vi.fn(() => ({ paths: "later-dom-value" })),
      assertApplied: vi.fn(),
      markSaved: vi.fn(),
      assertUndoSafe: vi.fn(),
      onRestore: vi.fn(),
    });

    const saving = persistence.save("paths", "captured");
    resolveSchema(schema);
    await saving;

    expect(apply).toHaveBeenCalledWith({ paths: "captured" }, undefined);
  });
});
