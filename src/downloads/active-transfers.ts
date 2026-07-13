const controllers = new Map<string, AbortController>();

export const ActiveTransfers = {
  register(historyId: string, controller: AbortController): void {
    controllers.get(historyId)?.abort();
    controllers.set(historyId, controller);
  },

  cancel(historyId: string): boolean {
    const controller = controllers.get(historyId);
    if (!controller) return false;
    controller.abort();
    return true;
  },

  finish(historyId: string, controller: AbortController): void {
    if (controllers.get(historyId) === controller) controllers.delete(historyId);
  },

  clear(): void {
    controllers.clear();
  },
};
