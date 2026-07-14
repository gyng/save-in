import { runBackgroundTask } from "../src/background/event-task.ts";
import { Log } from "../src/background/log.ts";
import { runEventTask } from "../src/shared/event-task.ts";

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

test("contains a synchronous logging failure while handling an event rejection", async () => {
  vi.spyOn(Log, "add").mockImplementation(() => {
    throw new Error("storage unavailable");
  });

  await expect(
    runBackgroundTask("startup failed", () => Promise.reject(new Error("bad startup"))),
  ).resolves.toBeUndefined();
});

test("contains an asynchronous error-reporter rejection", async () => {
  await expect(
    runEventTask(
      () => Promise.reject(new Error("work failed")),
      () => Promise.reject(new Error("report failed")),
    ),
  ).resolves.toBeUndefined();
});

test("contains a synchronous error-reporter failure", async () => {
  await expect(
    runEventTask(
      () => {
        throw new Error("work failed");
      },
      () => {
        throw new Error("report failed");
      },
    ),
  ).resolves.toBeUndefined();
});
