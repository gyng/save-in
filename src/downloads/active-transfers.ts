import { webExtensionApi } from "../platform/web-extension-api.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
import type { SessionWriteState } from "../shared/session-state.ts";
import { ACTIVE_TRANSFERS_SESSION_KEY } from "../shared/storage-keys.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

export type ActiveTransferRecord = {
  requestId?: string;
  downloadId?: number;
  updatedAt: number;
};

type ActiveTransfer = ActiveTransferRecord & { controller: AbortController };

const controllers = new Map<string, ActiveTransfer>();
const privateControllers = new Set<AbortController>();
const writes: SessionWriteState = { queues: new Map() };
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

const heartbeat = () => {
  const getPlatformInfo: unknown = Reflect.get(webExtensionApi.runtime, "getPlatformInfo");
  if (typeof getPlatformInfo === "function") {
    void Promise.resolve(Reflect.apply(getPlatformInfo, webExtensionApi.runtime, [])).catch(
      () => {},
    );
  }
};

const syncKeepalive = () => {
  if (controllers.size + privateControllers.size > 0) {
    keepaliveTimer ??= setInterval(heartbeat, 25_000);
  } else if (keepaliveTimer !== undefined) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
  }
};

const storedRecords = (value: unknown): Record<string, ActiveTransferRecord> => {
  if (!isStringKeyedRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, candidate]) => {
      if (!id.trim() || !isStringKeyedRecord(candidate)) return [];
      const { requestId, downloadId, updatedAt } = candidate;
      if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < 0)
        return [];
      const validRequestId = typeof requestId === "string" && requestId.trim().length > 0;
      const validDownloadId =
        typeof downloadId === "number" && Number.isSafeInteger(downloadId) && downloadId >= 0;
      return [
        [
          id,
          {
            updatedAt,
            ...(validRequestId ? { requestId } : {}),
            ...(validDownloadId ? { downloadId } : {}),
          },
        ],
      ];
    }),
  );
};

const persist = (historyId: string, record?: ActiveTransferRecord) =>
  updateSession<Record<string, ActiveTransferRecord>>(
    writes,
    extensionSessionStorage,
    ACTIVE_TRANSFERS_SESSION_KEY,
    (stored) => {
      const records = storedRecords(stored);
      if (record) {
        records[historyId] = {
          updatedAt: record.updatedAt,
          ...(record.requestId ? { requestId: record.requestId } : {}),
          ...(record.downloadId != null ? { downloadId: record.downloadId } : {}),
        };
      } else delete records[historyId];
      return records;
    },
  );

export const ActiveTransfers = {
  register(
    historyId: string,
    controller: AbortController,
    fields: Partial<Pick<ActiveTransferRecord, "requestId" | "downloadId">> = {},
  ): void {
    const previous = controllers.get(historyId);
    if (previous?.controller === controller) {
      ActiveTransfers.update(historyId, fields);
      return;
    }
    previous?.controller.abort();
    const record = { ...fields, updatedAt: Date.now(), controller };
    controllers.set(historyId, record);
    void persist(historyId, record);
    syncKeepalive();
  },

  cancel(historyId: string): boolean {
    const transfer = controllers.get(historyId);
    if (!transfer) return false;
    transfer.controller.abort();
    return true;
  },

  get(historyId: string): ActiveTransferRecord | undefined {
    const transfer = controllers.get(historyId);
    if (!transfer) return undefined;
    const { requestId, downloadId, updatedAt } = transfer;
    return {
      updatedAt,
      ...(requestId ? { requestId } : {}),
      ...(downloadId != null ? { downloadId } : {}),
    };
  },

  update(
    historyId: string,
    fields: Partial<Pick<ActiveTransferRecord, "requestId" | "downloadId">>,
  ): void {
    const transfer = controllers.get(historyId);
    if (!transfer) return;
    Object.assign(transfer, fields, { updatedAt: Date.now() });
    void persist(historyId, transfer);
  },

  hold(controller: AbortController): void {
    privateControllers.add(controller);
    syncKeepalive();
  },

  finish(historyId: string, controller: AbortController): void {
    if (controllers.get(historyId)?.controller === controller) {
      controllers.delete(historyId);
      void persist(historyId);
    }
    syncKeepalive();
  },

  release(controller: AbortController): void {
    privateControllers.delete(controller);
    syncKeepalive();
  },

  async recover(): Promise<Record<string, ActiveTransferRecord>> {
    const stored = await getSession(extensionSessionStorage, ACTIVE_TRANSFERS_SESSION_KEY);
    const records = storedRecords(stored[ACTIVE_TRANSFERS_SESSION_KEY]);
    await extensionSessionStorage.remove(ACTIVE_TRANSFERS_SESSION_KEY);
    return records;
  },

  clear(): void {
    for (const transfer of controllers.values()) transfer.controller.abort();
    for (const controller of privateControllers) controller.abort();
    controllers.clear();
    privateControllers.clear();
    syncKeepalive();
  },

  async reset(): Promise<void> {
    ActiveTransfers.clear();
    for (;;) {
      const pending = [...writes.queues.values()];
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  },
};
