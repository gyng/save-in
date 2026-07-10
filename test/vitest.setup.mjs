import { vi } from "vitest";

// jest-webextension-mock (and the odd test helper) calls jest.fn at import
// time; vitest's vi API is compatible
globalThis.jest = vi;

await import("jest-webextension-mock");

// Util is a pure, side-effect-free shared helper (like a stdlib): expose the
// real implementation as a global so every module that depends on it works
// without each test re-seeding a stub.
globalThis.Util = (await import("../src/util.js")).default;
