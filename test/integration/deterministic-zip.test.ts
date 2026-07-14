import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";

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
