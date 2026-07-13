import {
  enqueueFilename,
  filenameQueue,
  removeFilename,
  type FinalFilenameMap,
} from "../src/downloads/filename-listener.ts";

describe("persisted final-filename queues", () => {
  test("normalizes malformed legacy queue entries before updating them", () => {
    const stored = {
      valid: ["first.jpg", 7, null, "second.jpg"],
      invalid: { filename: "old.jpg" },
    } as unknown as FinalFilenameMap;

    expect(enqueueFilename(stored, "valid", "third.jpg")).toEqual({
      valid: ["first.jpg", "second.jpg", "third.jpg"],
    });
    expect(removeFilename(stored, "valid", "first.jpg")).toEqual({
      valid: "second.jpg",
    });
  });

  test("accepts the legacy scalar shape and rejects non-string values", () => {
    expect(filenameQueue("single.jpg")).toEqual(["single.jpg"]);
    expect(filenameQueue(["one.jpg", false, "two.jpg"])).toEqual(["one.jpg", "two.jpg"]);
    expect(filenameQueue({ filename: "nope.jpg" })).toEqual([]);
  });
});
