export const CONTROL_PAGE_PATH = "test/e2e/control.html";
export const CONTROL_FUNCTION =
  "(serializedRequest) => globalThis.__saveInE2EControl(serializedRequest)";
export const CONTROL_READY_EXPRESSION =
  'document.readyState === "complete" && typeof globalThis.__saveInE2EControl === "function"';
export const CONTENT_READY_MESSAGE_TYPE = "SAVE_IN_E2E_CONTENT_READY";
