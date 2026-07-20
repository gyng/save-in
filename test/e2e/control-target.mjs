export const CONTROL_PAGE_PATH = "test/e2e/control.html";
export const CONTROL_FUNCTION =
  "(serializedRequest) => globalThis.__saveInE2EControl(serializedRequest)";
export const CONTROL_READY_EXPRESSION =
  'document.readyState === "complete" && typeof globalThis.__saveInE2EControl === "function"';
