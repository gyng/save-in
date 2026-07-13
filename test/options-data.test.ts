import { defaultOptions } from "../src/config/option-defaults.ts";
import { options } from "../src/config/options-data.ts";

test("the shared options bag is complete before background initialization", () => {
  expect(options).toEqual(defaultOptions());
});
