// The E2E driver evaluates calls in this real extension context. Keeping a
// background entry gives Firefox RDP a stable target and wakes Chrome MV3.
globalThis.saveInE2ECallerReady = true;
