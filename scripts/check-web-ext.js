// @ts-check

const path = require("node:path");

/** @typedef {{code: string, file: string, message: string}} WebExtDiagnostic */
/** @typedef {{warnings: WebExtDiagnostic[], errors: WebExtDiagnostic[], notices: WebExtDiagnostic[]}} WebExtReport */

const root = path.resolve(__dirname, "..");
const expectedCompatibilityDiagnostics = new Set([
  'MANIFEST_PERMISSIONS|manifest.json|/permissions: Invalid permissions "offscreen" at 5.',
  'BACKGROUND_SERVICE_WORKER_IGNORED|manifest.json|Unsupported "/background/service_worker" manifest property is ignored by Firefox.',
  "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION|manifest.json|Manifest key not supported by the specified minimum Firefox for Android version",
  "UNSUPPORTED_API|background.js|offscreen.createDocument is not supported",
  "UNSUPPORTED_API|background.js|downloads.onDeterminingFilename is not supported",
  "UNSUPPORTED_API|background.sw.js|offscreen.createDocument is not supported",
  "UNSUPPORTED_API|background.sw.js|downloads.onDeterminingFilename is not supported",
]);

const main = async () => {
  // web-ext does not publish declarations for its internal command API.
  // @ts-expect-error -- checked immediately through the WebExtReport boundary below.
  const { default: lint } = await import("../node_modules/web-ext/lib/cmd/lint.js");
  const originalWrite = process.stdout.write;
  /** @type {WebExtReport | undefined} */
  let report;
  try {
    // addons-linter writes JSON even when embedded. Its returned object lets
    // this check review compatibility diagnostics without printing warnings.
    process.stdout.write = () => true;
    report = await lint(
      {
        artifactsDir: path.join(root, "web-ext-artifacts"),
        boring: true,
        ignoreFiles: ["src/**"],
        metadata: false,
        output: "json",
        pretty: false,
        privileged: false,
        selfHosted: false,
        sourceDir: path.join(root, "dist/bundled-pkg"),
        verbose: false,
        warningsAsErrors: false,
      },
      { shouldExitProgram: false },
    );
  } finally {
    process.stdout.write = originalWrite;
  }
  if (!report) throw new Error("web-ext returned no validation report");

  const diagnostics = report.warnings.map(
    ({ code, file, message }) => `${code}|${file}|${message}`,
  );
  const unexpected = diagnostics.filter(
    (diagnostic) => !expectedCompatibilityDiagnostics.has(diagnostic),
  );
  const missing = [...expectedCompatibilityDiagnostics].filter(
    (diagnostic) => !diagnostics.includes(diagnostic),
  );
  if (report.errors.length || report.notices.length || unexpected.length || missing.length) {
    throw new Error(
      [
        "web-ext validation failed",
        ...report.errors.map(({ code, file, message }) => `${code} ${file}: ${message}`),
        ...report.notices.map(({ code, file, message }) => `${code} ${file}: ${message}`),
        ...unexpected.map((diagnostic) => `Unexpected warning: ${diagnostic}`),
        ...missing.map((diagnostic) => `Reviewed diagnostic changed or disappeared: ${diagnostic}`),
      ].join("\n"),
    );
  }

  console.log(
    `Web extension validation passed (${diagnostics.length} reviewed dual-browser diagnostics, 0 unreviewed warnings).`,
  );
};

void main();
