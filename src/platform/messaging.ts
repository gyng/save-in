// Generic internal-message send helper. Lives in platform/ (not shared/)
// because it makes a live runtime.sendMessage call; shared/ stays contract-only.
import type { InternalMessage, ResponseFor } from "../shared/message-protocol.ts";

type RuntimeMessenger = {
  sendMessage(message: unknown): Promise<unknown>;
};

// WebExtension declarations do not correlate a request discriminator with its
// response. Keep the single host-boundary assertion here so callers and
// background handlers share the same protocol map.
export const sendInternalMessage = <Request extends InternalMessage>(
  runtime: RuntimeMessenger,
  request: Request,
): Promise<ResponseFor<Request>> => runtime.sendMessage(request) as Promise<ResponseFor<Request>>;
