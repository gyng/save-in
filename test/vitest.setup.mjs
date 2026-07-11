import { vi } from "vitest";

// jest-webextension-mock (and the odd test helper) calls jest.fn at import
// time; vitest's vi API is compatible
globalThis.jest = vi;

await import("jest-webextension-mock");

// Util is a pure, side-effect-free shared helper (like a stdlib): expose the
// real implementation as a global so every module that depends on it works
// without each test re-seeding a stub.
globalThis.Util = (await import("../src/util.js")).default;

// SessionState (the storage.session wrapper) is a thin global too; it feature-
// detects browser.storage.session at call time, which tests mock per-test.
// Tests that want a plain stub (download-flow/download-mv3) override it.
globalThis.SessionState = (await import("../src/session-state.js")).default;

// DownloadState (the per-download record store) is a thin global over SessionState;
// tests that want a plain stub override it.
globalThis.DownloadState = (await import("../src/download-state.js")).default;

// OffscreenClient (Chrome SW offscreen-document client) is referenced by
// download.js at call time; the real object defaults to canUse()===false under
// jsdom (URL.createObjectURL exists). Tests override its methods as needed.
globalThis.OffscreenClient = (await import("../src/offscreen-client.js")).default;
