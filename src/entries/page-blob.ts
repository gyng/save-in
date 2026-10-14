// Content script for every frame, including about:blank and blob: documents.
// A page's blob URL is readable only inside the frame that created it, so
// subframes need this server; it is kept apart from content.ts so click-to-save
// and Page Sources do not start running in every iframe.
import { servePageBlob } from "../content/page-blob.ts";

declare const SAVE_IN_CONTENT_E2E: boolean;

chrome.runtime.onConnect.addListener(servePageBlob);

// Browser tests cannot otherwise learn a subframe's extension frame ID: the
// sender of this announcement carries it. A frame announces when it loads and
// again when asked, so a test can listen before or after the frame is ready.
if (SAVE_IN_CONTENT_E2E) {
  const E2E_FRAME_READY = "SAVE_IN_E2E_FRAME_READY";
  const announce = () =>
    chrome.runtime.sendMessage({ type: E2E_FRAME_READY }, () => void chrome.runtime.lastError);
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "type") === E2E_FRAME_READY
    ) {
      announce();
    }
  });
  announce();
}
