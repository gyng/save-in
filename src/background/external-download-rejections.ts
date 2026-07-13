import { extensionLocalStorage } from "../platform/storage-areas.ts";
import { EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY } from "../shared/storage-keys.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";
import type { DownloadRequestBody } from "../shared/message-protocol.ts";
import type { ExternalDownloadRejection } from "../shared/external-download-rejection-types.ts";

type RejectionStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

const MAX_REJECTED_CALLERS = 20;

const normalizeRejection = (value: unknown): ExternalDownloadRejection | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const senderId = Reflect.get(value, "senderId");
  const attempts = Reflect.get(value, "attempts");
  const lastRejectedAt = Reflect.get(value, "lastRejectedAt");
  const requestType = Reflect.get(value, "requestType");
  if (
    typeof senderId !== "string" ||
    !senderId ||
    typeof attempts !== "number" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    typeof lastRejectedAt !== "string" ||
    !Number.isFinite(Date.parse(lastRejectedAt)) ||
    (requestType !== "activeTab" && requestType !== "url" && requestType !== "unknown")
  ) {
    return null;
  }
  return { senderId, attempts, lastRejectedAt, requestType };
};

const normalizeRejections = (value: unknown): ExternalDownloadRejection[] =>
  (Array.isArray(value) ? value : [])
    .map(normalizeRejection)
    .filter((entry): entry is ExternalDownloadRejection => entry !== null)
    .toSorted((left, right) => Date.parse(right.lastRejectedAt) - Date.parse(left.lastRejectedAt))
    .slice(0, MAX_REJECTED_CALLERS);

export const createExternalDownloadRejections = (
  storage: RejectionStorage,
  now: () => Date = () => new Date(),
) => {
  let writes: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<ExternalDownloadRejection[]> => {
    try {
      const stored = await storage.get(EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY);
      return normalizeRejections(stored[EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY]);
    } catch (error) {
      recordPersistenceFailure(
        {
          area: "local",
          operation: "read",
          key: EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY,
        },
        error,
      );
      return [];
    }
  };

  const write = async (entries: ExternalDownloadRejection[]): Promise<void> => {
    try {
      await storage.set({ [EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY]: entries });
    } catch (error) {
      recordPersistenceFailure(
        {
          area: "local",
          operation: "write",
          key: EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY,
        },
        error,
      );
    }
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = writes.catch(() => {}).then(task);
    writes = next;
    return next;
  };

  return {
    get: async (): Promise<ExternalDownloadRejection[]> => {
      await writes.catch(() => {});
      return read();
    },

    record: (senderId: string, request: DownloadRequestBody): Promise<void> => {
      if (!senderId) return Promise.resolve();
      return enqueue(async () => {
        const entries = await read();
        const previous = entries.find((entry) => entry.senderId === senderId);
        const requestType =
          request.target === "activeTab" ? "activeTab" : request.url ? "url" : "unknown";
        const updated: ExternalDownloadRejection = {
          senderId,
          attempts: Math.min(Number.MAX_SAFE_INTEGER, (previous?.attempts || 0) + 1),
          lastRejectedAt: now().toISOString(),
          requestType,
        };
        await write(
          [updated, ...entries.filter((entry) => entry.senderId !== senderId)].slice(
            0,
            MAX_REJECTED_CALLERS,
          ),
        );
      });
    },

    clear: (senderId: string): Promise<void> =>
      enqueue(async () => {
        const entries = await read();
        await write(entries.filter((entry) => entry.senderId !== senderId));
      }),
  };
};

export const ExternalDownloadRejections = createExternalDownloadRejections(extensionLocalStorage);
