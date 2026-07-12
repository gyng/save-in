import { MESSAGE_TYPES } from "../shared/constants.ts";

export type SendResponse = (response: unknown) => void;

// Chrome requires a literal synchronous `true` when sendResponse will be used
// after the listener returns. Keeping that rule here makes async error handling
// identical for every message handler.
export const respondAsync = (
  type: string,
  task: Promise<void>,
  sendResponse: SendResponse,
  onError: (error: unknown) => void = () => {},
): true => {
  void task.catch((error: unknown) => {
    try {
      onError(error);
    } catch {
      // Diagnostics are best-effort; the protocol response must still be delivered.
    }
    sendResponse({
      type,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
  });
  return true;
};
