import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";

const { canonicalizeZip, zipDateFor } = require("../scripts/lib/canonicalize-zip.js");

test("clamps Unix epoch to the earliest timestamp ZIP can encode", () => {
  expect(zipDateFor(new Date(0)).toISOString()).toBe("1980-01-01T00:00:00.000Z");
});

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
  expect(statSync(first).mtimeMs).toBe(0);
  expect(statSync(second).mtimeMs).toBe(0);
});

test("canonicalizes ZIP timestamps independently of the build timezone", async () => {
  const root = mkdtempSync(join(tmpdir(), "save-in-zip-timezone-"));
  const utc = join(root, "utc.zip");
  const singapore = join(root, "singapore.zip");
  const input = new JSZip();
  input.file("extension.txt", "same bytes\n", { date: new Date("2026-01-02T03:04:05Z") });
  const source = await input.generateAsync({ type: "nodebuffer" });
  writeFileSync(utc, source);
  writeFileSync(singapore, source);

  const canonicalizer = resolve("scripts/lib/canonicalize-zip.js");
  const run = (archive: string, timezone: string) =>
    execFileSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(canonicalizer)}).canonicalizeZip(${JSON.stringify(archive)})`,
      ],
      { env: { ...process.env, TZ: timezone } },
    );

  run(utc, "UTC");
  run(singapore, "Asia/Singapore");

  expect(readFileSync(singapore)).toEqual(readFileSync(utc));
});
