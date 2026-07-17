// @ts-check

const crypto = require("node:crypto");

/**
 * @param {number} [pid]
 * @param {number} [now]
 * @param {string} [nonce]
 */
const createE2ERunId = (
  pid = process.pid,
  now = Date.now(),
  nonce = crypto.randomBytes(8).toString("hex"),
) => `${pid}-${now}-${nonce}`;

// Direct launcher use has no outer runner to provide E2E_RUN_ID. Keep one
// process-wide fallback so every browser resource created by that run agrees
// on ownership without relying on a namespace-local PID.
const fallbackRunId = createE2ERunId();

const currentE2ERunId = () => {
  const configured = process.env.E2E_RUN_ID?.trim();
  return configured && /^[a-z0-9_-]+$/i.test(configured) ? configured : fallbackRunId;
};

module.exports = { createE2ERunId, currentE2ERunId };
