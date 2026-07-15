// @ts-check

const JSZip = require("jszip");
const {
  compareTimingReports,
  decodeReport,
  readReports,
  timingEnvironmentMismatches,
} = require("./compare-e2e-timings.js");

/** @param {string} message */
const notice = (message) => console.log(`::notice title=E2E timing comparison::${message}`);

/** @param {string} path @param {string} token */
const githubApi = async (path, token) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response;
};

/** @param {string} repository @param {string} token @param {string | undefined} currentRunId @param {string} artifactPrefix */
const findBaselineArtifact = async (
  repository,
  token,
  currentRunId,
  artifactPrefix = "e2e-timings-",
) => {
  const runsResponse = await githubApi(
    `/repos/${repository}/actions/workflows/ci.yml/runs?branch=master&status=success&event=push&per_page=10`,
    token,
  );
  const runsBody = /** @type {unknown} */ (await runsResponse.json());
  if (runsBody === null || typeof runsBody !== "object" || !("workflow_runs" in runsBody)) {
    throw new Error("GitHub workflow-runs response is invalid");
  }
  const runs = Array.isArray(runsBody.workflow_runs) ? runsBody.workflow_runs : [];
  for (const run of runs) {
    if (run === null || typeof run !== "object" || !("id" in run)) continue;
    const runId = String(run.id);
    if (runId === currentRunId) continue;
    const artifactsResponse = await githubApi(
      `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      token,
    );
    const artifactsBody = /** @type {unknown} */ (await artifactsResponse.json());
    if (
      artifactsBody === null ||
      typeof artifactsBody !== "object" ||
      !("artifacts" in artifactsBody) ||
      !Array.isArray(artifactsBody.artifacts)
    ) {
      continue;
    }
    const artifact = artifactsBody.artifacts.find(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        "name" in candidate &&
        typeof candidate.name === "string" &&
        candidate.name.startsWith(artifactPrefix) &&
        !("expired" in candidate && candidate.expired === true),
    );
    if (
      artifact &&
      "archive_download_url" in artifact &&
      typeof artifact.archive_download_url === "string"
    ) {
      return artifact.archive_download_url.replace("https://api.github.com", "");
    }
  }
  return undefined;
};

/** @param {string} artifactPath @param {string} token */
const readArtifactReports = async (artifactPath, token) => {
  const response = await githubApi(artifactPath, token);
  const archive = await JSZip.loadAsync(await response.arrayBuffer());
  const reportFiles = Object.values(archive.files).filter(
    (entry) => !entry.dir && /(?:^|\/)timings-(?:chrome|firefox)\.json$/.test(entry.name),
  );
  return Promise.all(
    reportFiles.map(async (entry) =>
      decodeReport(/** @type {unknown} */ (JSON.parse(await entry.async("string"))), entry.name),
    ),
  );
};

/** @param {string[]} argv */
const parseArguments = (argv) => {
  let current;
  /** @type {string | undefined} */
  let artifactPrefix = "e2e-timings-";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--current") current = argv[++index];
    else if (argument === "--artifact-prefix") artifactPrefix = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!current) throw new Error("Usage: compare-e2e-ci-baseline --current <artifact-directory>");
  if (!artifactPrefix) throw new Error("--artifact-prefix requires a value");
  return { current, artifactPrefix };
};

/** @param {string[]} argv */
const currentDirectory = (argv) => parseArguments(argv).current;

const main = async () => {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    notice("Skipped because GitHub credentials are unavailable.");
    return;
  }
  const options = parseArguments(process.argv.slice(2));
  const artifactPath = await findBaselineArtifact(
    repository,
    token,
    process.env.GITHUB_RUN_ID,
    options.artifactPrefix,
  );
  if (!artifactPath) {
    notice("No successful master timing artifact is available yet.");
    return;
  }
  const baselineReports = await readArtifactReports(artifactPath, token);
  const currentReports = readReports(options.current);
  const mismatches = timingEnvironmentMismatches(baselineReports, currentReports);
  for (const mismatch of mismatches) {
    notice(
      `Skipped ${mismatch.browser}: browser changed from ${mismatch.baselineVersion} to ` +
        `${mismatch.currentVersion}.`,
    );
  }
  const regressions = compareTimingReports(baselineReports, currentReports);
  if (!regressions.length) {
    notice(
      mismatches.length
        ? "No per-case regression above 25% among comparable browsers."
        : "No per-case regression above 25% versus the latest successful master run.",
    );
    return;
  }
  for (const regression of regressions) {
    const location = regression.moduleId ? `file=${regression.moduleId},` : "";
    console.log(
      `::warning ${location}title=E2E timing ${regression.severity}::` +
        `${regression.browser} ${regression.name}: ${Math.round(regression.baselineMs)}ms -> ` +
        `${Math.round(regression.currentMs)}ms (+${Math.round((regression.ratio - 1) * 100)}%)`,
    );
  }
};

if (require.main === module) {
  main().catch((error) => {
    notice(`Comparison unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
}

module.exports = {
  currentDirectory,
  findBaselineArtifact,
  parseArguments,
  readArtifactReports,
};
