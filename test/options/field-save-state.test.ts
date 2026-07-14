import { createFieldSaveState } from "../../src/options/field-save-state.ts";

describe("per-field save state", () => {
  test("one successful field cannot clear another dirty field", () => {
    const state = createFieldSaveState();
    state.markDirty("a");
    state.markDirty("b");
    const a = state.begin("a");
    state.succeed("a", a);
    expect(state.hasUnsaved()).toBe(true);
    expect(state.unsavedIds()).toEqual(["b"]);
  });

  test("ignores stale completion from an older save generation", () => {
    const state = createFieldSaveState();
    state.markDirty("a");
    const old = state.begin("a");
    state.markDirty("a");
    const current = state.begin("a");
    state.succeed("a", old);
    expect(state.hasUnsaved()).toBe(true);
    state.fail("a", current);
    expect(state.status("a")).toBe("failed");
  });

  test("reports whether any field save is currently in flight", () => {
    const state = createFieldSaveState();
    state.markDirty("a");
    expect(state.anySaving()).toBe(false);
    const token = state.begin("a");
    expect(state.anySaving()).toBe(true);
    state.succeed("a", token);
    expect(state.anySaving()).toBe(false);
  });

  test("keeps reporting an in-flight save after a newer edit marks the field dirty", () => {
    const state = createFieldSaveState();
    state.markDirty("a");
    const saving = state.begin("a");
    state.markDirty("a");
    expect(state.status("a")).toBe("dirty");
    expect(state.anySaving()).toBe(true);
    state.succeed("a", saving);
    expect(state.anySaving()).toBe(false);
    expect(state.hasUnsaved()).toBe(true);
  });

  test("clears dirty and in-flight state together", () => {
    const state = createFieldSaveState();
    state.markDirty("dirty");
    state.begin("saving");

    state.clear();

    expect(state.hasUnsaved()).toBe(false);
    expect(state.anySaving()).toBe(false);
  });
});
