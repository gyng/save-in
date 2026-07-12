import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("does not ship a redundant standalone click-to-copy bundle", () => {
  const config = readFileSync(resolve("rolldown.config.mjs"), "utf8");
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");

  expect(config).not.toContain('file: "dist/bundled/clicktocopy.js"');
  expect(stage).toContain('f === "clicktocopy.js"');
});
