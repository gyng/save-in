// Ambient globals for the vitest suite. Source modules import their dependencies
// now; tests seed/read them via global.* / globalThis (the vi.mock getter-
// bridges and jest-webextension-mock). Loosely typed on purpose — the tests are
// not the place to re-derive the source types.
export {};

declare global {
  // vitest.setup.mjs aliases jest -> vi so jest-webextension-mock (and the odd
  // test helper) can call jest.fn at import time
  const jest: typeof import("vitest").vi;
}
