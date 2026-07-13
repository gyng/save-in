// Browser-test entry: production startup plus the narrow command API used by
// CDP/RDP evaluation. Store builds use background.ts directly and therefore
// do not contain this privileged test surface.
import "./background.ts";
import { createBackgroundE2EApi } from "../background/e2e-api.ts";
import { installBackgroundE2EBridge } from "../background/e2e-bridge.ts";

installBackgroundE2EBridge(globalThis, createBackgroundE2EApi());
