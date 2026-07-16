import { isInternalMessage } from "../../../src/shared/message-protocol.ts";

test("accepts a History undo only with a concrete history ID", () => {
  expect(isInternalMessage({ type: "HISTORY_UNDO", body: { historyId: "h1" } })).toBe(true);
  expect(isInternalMessage({ type: "HISTORY_UNDO" })).toBe(false);
  expect(isInternalMessage({ type: "HISTORY_UNDO", body: { historyId: 1 } })).toBe(false);
});
