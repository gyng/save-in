import { runBackgroundTask } from "../src/background/event-task.ts";
import { Log } from "../src/background/log.ts";

test("turns rejected browser event work into a resolved logged task", async () => {
  vi.spyOn(Log, "add").mockResolvedValue(undefined);

  await expect(
    runBackgroundTask("tab activation failed", async () => {
      throw new Error("tab closed");
    }),
  ).resolves.toBeUndefined();

  expect(Log.add).toHaveBeenCalledWith("tab activation failed", "Error: tab closed");
});

test("also contains synchronous failures from event work", async () => {
  vi.spyOn(Log, "add").mockResolvedValue(undefined);

  await expect(
    runBackgroundTask("menu click failed", () => {
      throw new Error("bad click");
    }),
  ).resolves.toBeUndefined();

  expect(Log.add).toHaveBeenCalledWith("menu click failed", "Error: bad click");
});
