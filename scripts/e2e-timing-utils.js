// @ts-check

/** @param {string} moduleId */
const normalizeTimingModuleId = (moduleId) => {
  const normalized = moduleId.replaceAll("\\", "/");
  const marker = normalized.lastIndexOf("/test/e2e/");
  if (marker >= 0) return normalized.slice(marker + 1);
  const relativeMarker = normalized.indexOf("test/e2e/");
  return relativeMarker >= 0 ? normalized.slice(relativeMarker) : normalized;
};

/** @param {string} moduleId */
const timingBrowserForModule = (moduleId) => {
  const match = normalizeTimingModuleId(moduleId).match(/(?:^|[/._-])(chrome|firefox)(?=$|[/._-])/);
  return match?.[1] ?? "unknown";
};

/** @param {{browser: string, moduleId?: string, name: string}} testCase */
const timingCaseKey = ({ browser, moduleId = "", name }) =>
  `${browser}\0${normalizeTimingModuleId(moduleId)}\0${name}`;

module.exports = { normalizeTimingModuleId, timingBrowserForModule, timingCaseKey };
