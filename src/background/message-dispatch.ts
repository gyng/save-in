import { MESSAGE_TYPES } from "../shared/constants.ts";
import type { InternalMessage, ProtocolErrorResponse } from "../shared/message-protocol.ts";

export type SendResponse<Response = unknown> = (response: Response) => void;

// Chrome requires a literal synchronous `true` when sendResponse will be used
// after the listener returns. Keeping that rule here makes async error handling
// identical for every message handler.
export const respondAsync = <Type extends InternalMessage["type"]>(
  type: Type,
  task: Promise<void>,
  sendResponse: SendResponse<ProtocolErrorResponse<Type>>,
  onError: (error: unknown) => void = () => {},
  // External callers negotiate an API version and every other external
  // response carries it, so their failure response does too.
  version?: number,
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
        // API_ERRORS.INTERNAL_ERROR; messaging/protocol.ts already imports
        // this module, so the literal avoids an import cycle.
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
        ...(version === undefined ? {} : { version }),
      },
    });
  });
  return true;
};
