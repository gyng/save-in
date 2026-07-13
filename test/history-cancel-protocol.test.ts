import { isInternalMessage } from "../src/shared/message-protocol.ts";

test("accepts a History cancellation only with a concrete history ID", () => {
  expect(isInternalMessage({ type: "HISTORY_CANCEL", body: { historyId: "h1" } })).toBe(true);
  expect(isInternalMessage({ type: "HISTORY_CANCEL" })).toBe(false);
  expect(isInternalMessage({ type: "HISTORY_CANCEL", body: { historyId: 1 } })).toBe(false);
});
