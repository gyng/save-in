/**
 * Installs request-ID deduplication ahead of operation dispatch. In-flight
 * requests are always shared. Settled one-shot results remain available for a
 * bounded window so a lost protocol reply cannot duplicate the browser
 * mutation; safe-to-repeat operations are released as soon as they settle.
 *
 * @param {(serializedRequest: string) => Promise<string>} dispatch
 * @param {{maxOneShotResults?: number}} [options]
 */
export const createControlPageDispatcher = (dispatch, { maxOneShotResults = 256 } = {}) => {
  /** @type {Map<string, {pending: Promise<string>, retryMode: "read" | "idempotent" | "one-shot"}>} */
  const requests = new Map();
  /** @type {string[]} */
  const settledOneShotIds = [];
  /** @param {string} serializedEnvelope */
  return (serializedEnvelope) => {
    const envelope = /** @type {unknown} */ (JSON.parse(serializedEnvelope));
    if (
      envelope === null ||
      typeof envelope !== "object" ||
      !("requestId" in envelope) ||
      typeof envelope.requestId !== "string" ||
      !("retryMode" in envelope) ||
      !["read", "idempotent", "one-shot"].includes(/** @type {string} */ (envelope.retryMode)) ||
      !("request" in envelope)
    ) {
      throw new Error("Invalid E2E control envelope");
    }
    const requestId = envelope.requestId;
    const existing = requests.get(requestId);
    if (existing) return existing.pending;
    const retryMode = /** @type {"read" | "idempotent" | "one-shot"} */ (envelope.retryMode);
    const pending = Promise.resolve(dispatch(JSON.stringify(envelope.request)));
    const entry = { pending, retryMode };
    requests.set(requestId, entry);
    const settle = () => {
      if (requests.get(requestId) !== entry) return;
      if (retryMode !== "one-shot") {
        requests.delete(requestId);
        return;
      }
      settledOneShotIds.push(requestId);
      while (settledOneShotIds.length > maxOneShotResults) {
        const expiredId = settledOneShotIds.shift();
        if (expiredId !== undefined) requests.delete(expiredId);
      }
    };
    void pending.then(settle, settle);
    return pending;
  };
};
