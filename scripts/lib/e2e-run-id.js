// @ts-check

const currentE2ERunId = () => {
  const configured = process.env.E2E_RUN_ID?.trim();
  return configured && /^[a-z0-9_-]+$/i.test(configured) ? configured : String(process.pid);
};

module.exports = { currentE2ERunId };
