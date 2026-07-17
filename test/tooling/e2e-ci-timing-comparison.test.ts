import { createRequire } from "node:module";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
const { currentDirectory, findBaselineArtifact, parseArguments, readArtifactReports } =
  require("../../scripts/compare-e2e-ci-baseline.js") as {
    currentDirectory: (argv: string[]) => string;
    findBaselineArtifact: (
      repository: string,
      token: string,
      currentRunId?: string,
      artifactPrefix?: string,
    ) => Promise<string | undefined>;
    parseArguments: (argv: string[]) => { current: string; artifactPrefix: string };
    readArtifactReports: (
      artifactPath: string,
      token: string,
    ) => Promise<Array<{ browser: string; tests: Array<{ moduleId?: string; name: string }> }>>;
  };

afterEach(() => vi.unstubAllGlobals());

test("selects the current-browser artifact from the latest successful master run", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ workflow_runs: [{ id: 77 }] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [
            {
              name: "e2e-minimum-timings-sha",
              archive_download_url: "https://api.github.com/minimum",
              expired: false,
            },
            {
              name: "e2e-timings-sha",
              archive_download_url: "https://api.github.com/current",
              expired: false,
            },
          ],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  await expect(findBaselineArtifact("owner/repo", "token")).resolves.toBe("/current");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("selects the pinned minimum-browser artifact independently", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ workflow_runs: [{ id: 77 }] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [
            {
              name: "e2e-timings-sha",
              archive_download_url: "https://api.github.com/current",
              expired: false,
            },
            {
              name: "e2e-minimum-timings-sha",
              archive_download_url: "https://api.github.com/minimum",
              expired: false,
            },
          ],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    findBaselineArtifact("owner/repo", "token", undefined, "e2e-minimum-timings-"),
  ).resolves.toBe("/minimum");
});

test("decodes timing reports from the downloaded artifact", async () => {
  const zip = new JSZip();
  zip.file(
    "run-1/timings-chrome.json",
    JSON.stringify({
      browser: "chrome",
      tests: [
        {
          moduleId: "/runner/repo/test/e2e/chrome/downloads.e2e.mjs",
          name: "saves",
          durationMs: 100,
        },
      ],
    }),
  );
  const archive = await zip.generateAsync({ type: "uint8array" });
  const responseBody = Uint8Array.from(archive).buffer;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(responseBody)));

  await expect(readArtifactReports("/artifact", "token")).resolves.toMatchObject([
    {
      browser: "chrome",
      tests: [{ moduleId: "test/e2e/chrome/downloads.e2e.mjs", name: "saves" }],
    },
  ]);
});

test("requires an explicit current artifact directory", () => {
  expect(currentDirectory(["--current", "dist/e2e-artifacts"])).toBe("dist/e2e-artifacts");
  expect(
    parseArguments([
      "--current",
      "dist/e2e-artifacts",
      "--artifact-prefix",
      "e2e-minimum-timings-",
    ]),
  ).toEqual({
    current: "dist/e2e-artifacts",
    artifactPrefix: "e2e-minimum-timings-",
  });
  expect(() => currentDirectory([])).toThrow("--current");
});
