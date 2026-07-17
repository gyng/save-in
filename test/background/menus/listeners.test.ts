// Auto-mock the Shortcut helpers with spy:true here in the test entry: the
// mock must be registered before the case files (and the fixture they import)
// first import shortcut.ts, so it cannot live in the imported fixture.
vi.mock(import("../../../src/downloads/shortcut.ts"), { spy: true });

import "./download-listener.cases.ts";
import "./tab-listener.cases.ts";
