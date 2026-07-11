import { DownloadStateStore } from "../src/download-state.ts";
import { SessionStateStore } from "../src/session-state.ts";
import {
  ApplicationState,
  Counter,
  DownloadState,
  SessionState,
} from "../src/application-state.ts";

describe("state service instances", () => {
  test("the production views belong to one immutable application state", () => {
    expect(Object.isFrozen(ApplicationState)).toBe(true);
    expect(SessionState).toBe(ApplicationState.session);
    expect(DownloadState).toBe(ApplicationState.downloads);
    expect(Counter).toBe(ApplicationState.counter);
  });

  test("session stores own independent serialization queues", async () => {
    const first = new SessionStateStore();
    const second = new SessionStateStore();
    vi.spyOn(first, "get").mockResolvedValue({ value: 1 });
    vi.spyOn(first, "set").mockResolvedValue(undefined);

    await first.update("value", (value) => value + 1);

    expect(first.set).toHaveBeenCalledWith({ value: 2 });
    expect(second.queue).not.toBe(first.queue);
  });

  test("download stores own independent maps and hydration", async () => {
    const session = new SessionStateStore();
    vi.spyOn(session, "get").mockResolvedValue({});
    vi.spyOn(session, "update").mockResolvedValue(undefined);
    const first = new DownloadStateStore(session);
    const second = new DownloadStateStore(session);

    await first.merge(7, { adopted: true });

    expect(first.records.get(7)).toEqual({ adopted: true });
    expect(second.records.has(7)).toBe(false);
    expect(second.hydration).toBeNull();
  });
});
