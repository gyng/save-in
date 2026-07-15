import { Log } from "./log.ts";
import { runEventTask } from "../shared/event-task.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";

// Browser event dispatch does not consistently observe returned promises.
// Always contain rejections here so tab-close races and failed initialization
// are diagnostic events rather than unhandled worker rejections.
export const runBackgroundTask = (
  label: string,
  work: () => void | Promise<unknown>,
  writeOptions: PrivateWriteOptions = {},
): Promise<void> =>
  runEventTask(work, (error) => {
    try {
      return writeOptions.privateContext
        ? Log.add(label, String(error), writeOptions)
        : Log.add(label, String(error));
    } catch {
      // Logging must never recreate the event rejection it is containing.
      return undefined;
    }
  });
