import { vi } from "vitest";

// jest-webextension-mock (and the odd test helper) calls jest.fn at import
// time; vitest's vi API is compatible
globalThis.jest = vi;

await import("jest-webextension-mock");

// Dependency modules (Util, SessionState, DownloadState, OffscreenClient, …)
// are now real ESM imports inside each src module and each test — they are no
// longer seeded as ambient globals here. Tests import the real implementation
// or vi.mock the module as needed.
