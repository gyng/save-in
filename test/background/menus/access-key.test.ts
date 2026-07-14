import { resolveMenuAccessKey } from "../../../src/menus/access-key.ts";

describe("menu access keys", () => {
  test("resolves automatic numbers and custom overrides", () => {
    expect(resolveMenuAccessKey(1)).toBe("1");
    expect(resolveMenuAccessKey(1, "g")).toBe("g");
  });

  test("rejects empty, reserved, and multi-character keys", () => {
    expect(resolveMenuAccessKey(1, "")).toBeNull();
    expect(resolveMenuAccessKey("&")).toBeNull();
    expect(resolveMenuAccessKey(10)).toBeNull();
  });
});
