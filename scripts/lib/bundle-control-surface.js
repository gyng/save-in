// @ts-check

const fs = require("fs");
const path = require("path");

const BACKGROUND_E2E_COMMAND_MARKER = "SAVE_IN_E2E_START_DOWNLOAD";

/** @param {string} bundleDir @param {boolean} expectE2EControl */
const assertBackgroundControlSurface = (bundleDir, expectE2EControl) => {
  for (const filename of ["background.js", "background.sw.js"]) {
    const bundle = fs.readFileSync(path.join(bundleDir, filename), "utf8");
    if (bundle.includes(BACKGROUND_E2E_COMMAND_MARKER) !== expectE2EControl) {
      throw new Error(`Unexpected e2e control surface in ${filename}`);
    }
  }
};

module.exports = { BACKGROUND_E2E_COMMAND_MARKER, assertBackgroundControlSurface };
