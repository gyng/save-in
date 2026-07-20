import { dispatchControlRequest } from "./control-client.mjs";
import { createControlPageDispatcher } from "./control-page-runtime.mjs";
import { createProtocolCodecs } from "./protocol-codecs.mjs";

const codecs = createProtocolCodecs();
const dispatch = createControlPageDispatcher((serializedRequest) =>
  dispatchControlRequest(serializedRequest, codecs),
);

Reflect.set(
  globalThis,
  "__saveInE2EControl",
  /** @param {string} serializedRequest */
  dispatch,
);
