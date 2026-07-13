import { Download } from "../src/downloads/download.ts";
import { Notifier } from "../src/downloads/notification.ts";
import {
  BACKGROUND_E2E_COMMAND,
  handleBackgroundE2ECommand,
} from "../src/background/e2e-command.ts";

test("starts one pipeline download without registering a duplicate expectation", async () => {
  const launch = vi.spyOn(Download, "launch").mockResolvedValue({
    status: "started",
    downloadId: 7,
  });
  const expectDownload = vi.spyOn(Notifier, "expectDownload");

  const response = await handleBackgroundE2ECommand({
    type: BACKGROUND_E2E_COMMAND,
    body: {
      content: "browser test",
      suggestedFilename: "bridge.txt",
    },
  });

  expect(response).toEqual({
    type: BACKGROUND_E2E_COMMAND,
    body: { status: "OK", result: { status: "started", downloadId: 7 } },
  });
  expect(launch).toHaveBeenCalledOnce();
  expect(expectDownload).not.toHaveBeenCalled();
});

test("ignores messages outside the e2e command protocol", async () => {
  await expect(handleBackgroundE2ECommand({ type: "WAKE_WARM" })).resolves.toBeNull();
});
