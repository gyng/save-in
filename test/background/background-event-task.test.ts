import { runBackgroundTask } from "../../src/background/background-event-task.ts";
import * as Log from "../../src/background/log.ts";
import { runEventTask } from "../../src/shared/event-task.ts";

test("turns rejected browser event work into a resolved logged task", async () => {
  vi.spyOn(Log, "addLogEntry").mockResolvedValue(undefined);

  await expect(
    runBackgroundTask("tab activation failed", async () => {
      throw new Error("tab closed");
    }),
  ).resolves.toBeUndefined();

  expect(Log.addLogEntry).toHaveBeenCalledWith("tab activation failed", "Error: tab closed");
});

test("also contains synchronous failures from event work", async () => {
  vi.spyOn(Log, "addLogEntry").mockResolvedValue(undefined);

  await expect(
    runBackgroundTask("menu click failed", () => {
      throw new Error("bad click");
    }),
  ).resolves.toBeUndefined();

  expect(Log.addLogEntry).toHaveBeenCalledWith("menu click failed", "Error: bad click");
});

test("does not persist failures from a private browser event", async () => {
  vi.spyOn(Log, "addLogEntry").mockResolvedValue(undefined);

  await runBackgroundTask(
    "private menu click failed",
    () => Promise.reject(new Error("private click")),
    { privateContext: true },
  );

  expect(Log.addLogEntry).toHaveBeenCalledWith(
    "private menu click failed",
    "Error: private click",
    {
      privateContext: true,
    },
  );
});

test("contains a synchronous logging failure while handling an event rejection", async () => {
  vi.spyOn(Log, "addLogEntry").mockImplementation(() => {
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
