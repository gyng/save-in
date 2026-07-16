import { describe, expect, test } from "vitest";

import { MESSAGE_TYPES } from "../../src/shared/constants.ts";
import { sendInternalMessage } from "../../src/platform/messaging.ts";

describe("sendInternalMessage", () => {
  test("delegates typed internal messages to the runtime boundary", async () => {
    const runtime = { sendMessage: vi.fn().mockResolvedValue({ type: MESSAGE_TYPES.OK }) };
    await expect(sendInternalMessage(runtime, { type: MESSAGE_TYPES.WAKE_WARM })).resolves.toEqual({
      type: MESSAGE_TYPES.OK,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: MESSAGE_TYPES.WAKE_WARM });
  });
});
