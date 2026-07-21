import { resolveMaxWorkers } from "../../config/vitest/base.mjs";

describe("Vitest worker policy", () => {
  test.each([
    [{ cores: 32, ci: "" }, 8],
    [{ cores: 32, ci: "true" }, 8],
    [{ cores: 6, ci: "" }, 2],
    [{ cores: 6, ci: "1" }, 6],
    [{ cores: 2, ci: "" }, 1],
  ])("bounds automatic workers for %j", (environment, expected) => {
    expect(resolveMaxWorkers({ ...environment, requested: undefined })).toBe(expected);
  });

  test("keeps the explicit worker override authoritative", () => {
    expect(resolveMaxWorkers({ requested: "12", ci: "true", cores: 32 })).toBe(12);
    expect(resolveMaxWorkers({ requested: "0", ci: "", cores: 32 })).toBe(1);
  });
});
