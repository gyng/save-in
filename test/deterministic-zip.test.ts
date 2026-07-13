import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";

const { canonicalizeZip } = require("../scripts/lib/canonicalize-zip.js");

test("canonicalizes ZIP entry order and volatile timestamps", async () => {
  const root = mkdtempSync(join(tmpdir(), "save-in-zip-"));
  const first = join(root, "first.zip");
  const second = join(root, "second.zip");
  const firstInput = new JSZip();
  firstInput.file("z.txt", "last\n", { date: new Date("2020-01-02") });
  firstInput.file("nested/a.txt", "first\n", { date: new Date("2020-01-02") });
  writeFileSync(first, await firstInput.generateAsync({ type: "nodebuffer" }));
  const secondInput = new JSZip();
  secondInput.file("nested/a.txt", "first\n", { date: new Date("2030-04-05") });
  secondInput.file("z.txt", "last\n", { date: new Date("2030-04-05") });
  writeFileSync(second, await secondInput.generateAsync({ type: "nodebuffer" }));

  await canonicalizeZip(first);
  await canonicalizeZip(second);

  expect(readFileSync(second)).toEqual(readFileSync(first));
});
