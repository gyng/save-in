import {
  clearPersistenceDiagnostics,
  getPersistenceDiagnostics,
  recordPersistenceFailure,
} from "../../src/shared/persistence-diagnostics.ts";
import {
  getSession,
  removeSession,
  setSession,
  updateSession,
  updateSessionStrict,
} from "../../src/shared/session-state.ts";

describe("persistence diagnostics", () => {
  beforeEach(clearPersistenceDiagnostics);

  test("records bounded, structured, sanitized failures", () => {
    for (let index = 0; index < 55; index += 1) {
      recordPersistenceFailure(
        { area: "local", operation: "write", key: `key-${index}` },
        new Error(`failure-${index}`),
      );
    }

    const failures = getPersistenceDiagnostics();
    expect(failures).toHaveLength(50);
    expect(failures[0]!).toMatchObject({
      area: "local",
      operation: "write",
      key: "key-5",
      error: "Error: failure-5",
    });
    expect(failures[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("bounds individual diagnostic errors", () => {
    recordPersistenceFailure(
      { area: "session", operation: "migrate", key: "legacy" },
      "x".repeat(501),
    );

    expect(getPersistenceDiagnostics()[0]!.error).toBe(`${"x".repeat(500)}…`);
  });

  test("session failures remain non-fatal but are observable", async () => {
    const storage = {
      get: vi.fn(() => Promise.reject(new Error("read denied"))),
      set: vi.fn(() => Promise.reject(new Error("write denied"))),
      remove: vi.fn(() => Promise.reject(new Error("remove denied"))),
    };

    await expect(getSession(storage, "state")).resolves.toEqual({});
    await expect(setSession(storage, { state: 1 }, "state")).resolves.toBeUndefined();
    await expect(removeSession(storage, "state")).resolves.toBeUndefined();

    expect(getPersistenceDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: "session", operation: "read", key: "state" }),
        expect.objectContaining({ area: "session", operation: "write", key: "state" }),
        expect.objectContaining({ area: "session", operation: "remove", key: "state" }),
      ]),
    );
  });

  // A reader may degrade to {}, but an update that rebased onto {} would write
  // a value computed from nothing over everything the read failed to return.
  test("a failed read leaves the stored value alone instead of rebasing onto it", async () => {
    let persisted: unknown = { 7: "seven", 8: "eight" };
    const storage = {
      get: vi.fn(() => Promise.reject(new Error("read denied"))),
      set: vi.fn((obj: Record<string, unknown>) => {
        persisted = obj.state;
        return Promise.resolve();
      }),
    };

    await updateSession({ queues: new Map() }, storage, "state", (value) => ({
      ...(value as Record<string, unknown> | undefined),
      9: "nine",
    }));

    expect(storage.set).not.toHaveBeenCalled();
    expect(persisted).toEqual({ 7: "seven", 8: "eight" });
    expect(getPersistenceDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: "session", operation: "update", key: "state" }),
      ]),
    );
  });

  test("missing session storage is a capability absence, not a failure", async () => {
    await getSession(undefined, "state");
    await setSession(undefined, { state: 1 }, "state");
    await removeSession(undefined, "state");
    // A host without storage.session is probed for, not broken: an update
    // there is a no-op, unlike the rejected read above.
    await updateSession({ queues: new Map() }, undefined, "state", () => 1);

    expect(getPersistenceDiagnostics()).toEqual([]);
  });

  test("a strict queued update reports diagnostics and rejects its caller", async () => {
    const writes = { queues: new Map() };
    const storage = {
      get: vi.fn(() => Promise.resolve({ state: 1 })),
      set: vi.fn(() => Promise.reject(new Error("write denied"))),
    };

    await expect(
      updateSessionStrict(writes, storage, "state", (value) => Number(value) + 1),
    ).rejects.toThrow("write denied");
    await vi.waitFor(() => expect(writes.queues.size).toBe(0));

    expect(getPersistenceDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: "session", operation: "update", key: "state" }),
      ]),
    );
  });

  test("strict updates support a missing session area and retire superseded queue turns", async () => {
    const writes = { queues: new Map<string, Promise<unknown>>() };
    await expect(
      updateSessionStrict(writes, undefined, "absent", () => 1),
    ).resolves.toBeUndefined();

    let releaseFirst: (() => void) | undefined;
    const storage = {
      get: vi.fn(() => Promise.resolve({ state: 0 })),
      set: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseFirst = resolve;
            }),
        )
        .mockResolvedValue(undefined),
    };
    const first = updateSessionStrict(writes, storage, "state", () => 1);
    const second = updateSessionStrict(writes, storage, "state", () => 2);
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await vi.waitFor(() => expect(writes.queues.size).toBe(0));
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(getPersistenceDiagnostics()).toEqual([]);
  });
});
