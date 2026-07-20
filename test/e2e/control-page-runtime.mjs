/**
 * Installs request-ID deduplication ahead of operation dispatch. A repeated
 * one-shot request returns the original promise/result while this page realm
 * lives, so a lost protocol reply cannot duplicate the browser mutation.
 *
 * @param {(serializedRequest: string) => Promise<string>} dispatch
 */
export const createControlPageDispatcher = (dispatch) => {
  /** @type {Map<string, Promise<string>>} */
  const requests = new Map();
  /** @param {string} serializedEnvelope */
  return (serializedEnvelope) => {
    const envelope = /** @type {unknown} */ (JSON.parse(serializedEnvelope));
    if (
      envelope === null ||
      typeof envelope !== "object" ||
      !("requestId" in envelope) ||
      typeof envelope.requestId !== "string" ||
      !("request" in envelope)
    ) {
      throw new Error("Invalid E2E control envelope");
    }
    const existing = requests.get(envelope.requestId);
    if (existing) return existing;
    const pending = dispatch(JSON.stringify(envelope.request));
    requests.set(envelope.requestId, pending);
    return pending;
  };
};
