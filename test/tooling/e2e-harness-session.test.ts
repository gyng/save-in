import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessSession } from "../e2e/harness-session.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "save-in-harness-session-"));
  roots.push(root);
  const downloads = join(root, "downloads");
  mkdirSync(downloads);
  const get = vi.fn(async () => ({ paths: "baseline", promptOnShift: false }));
  const resetCase = vi.fn(async () => true as const);
  const control = { storage: { local: { get } }, harness: { resetCase } };
  const harness = createHarnessSession({
    control: control as unknown as Parameters<typeof createHarnessSession>[0]["control"],
    downloadDir: () => downloads,
  });
  return { downloads, get, harness, resetCase };
};

test("restores one baseline and empties nested download artifacts after every case", async () => {
  const { downloads, get, harness, resetCase } = fixture();
  await harness.beginCase();
  mkdirSync(join(downloads, "nested"));
  writeFileSync(join(downloads, "nested", "download.txt"), "fixture");

  await harness.endCase();

  expect(resetCase).toHaveBeenCalledWith({ paths: "baseline", promptOnShift: false });
  expect(existsSync(join(downloads, "nested"))).toBe(false);

  await harness.beginCase();
  await harness.endCase();
  expect(get).toHaveBeenCalledOnce();
  expect(resetCase).toHaveBeenCalledTimes(2);
});

test("invalidates the cached baseline when a case intentionally preserves local storage", async () => {
  const { get, harness, resetCase } = fixture();
  await harness.beginCase();
  await harness.endCase({ preserveLocal: true });
  expect(resetCase).toHaveBeenLastCalledWith(undefined);

  await harness.beginCase();
  await harness.endCase();
  expect(get).toHaveBeenCalledTimes(2);
});

test("still cleans files and reports reset failures with their original details", async () => {
  const { downloads, harness, resetCase } = fixture();
  resetCase.mockRejectedValueOnce(new Error("browser state remained"));
  await harness.beginCase();
  writeFileSync(join(downloads, "download.txt"), "fixture");

  await expect(harness.endCase()).rejects.toThrow("browser state remained");
  expect(existsSync(join(downloads, "download.txt"))).toBe(false);
});
