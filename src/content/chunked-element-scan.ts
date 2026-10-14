// Full-document background discovery reads getComputedStyle for every classed,
// id'd, or styled element, which forces style resolution per element. Run it in
// bounded slices on idle callbacks so a large page never blocks input for the
// whole traversal. Shared by the Page Sources panel and automatic discovery.
const CHUNK_MINIMUM_ELEMENTS = 50;

export type ChunkedElementScan = { cancel(): void };

export const startChunkedElementScan = (
  elements: Iterator<Element>,
  visit: (element: Element) => void,
  done: () => void,
  { firstChunkNow = false }: { firstChunkNow?: boolean } = {},
): ChunkedElementScan => {
  let cancelled = false;
  let handle = 0;
  let usesIdleCallback = false;
  const runChunk = (deadline?: IdleDeadline) => {
    handle = 0;
    // A cancelled idle callback can still run where cancelIdleCallback is
    // missing and clearTimeout cannot reach it.
    if (cancelled) return;
    let processed = 0;
    for (;;) {
      const next = elements.next();
      if (next.done) {
        done();
        return;
      }
      visit(next.value);
      processed += 1;
      if (processed >= CHUNK_MINIMUM_ELEMENTS && (!deadline || deadline.timeRemaining() <= 1))
        break;
    }
    // Reading the deadline can run page or panel work that cancels this scan.
    if (cancelled) return;
    queueChunk();
  };
  const queueChunk = () => {
    if (typeof window.requestIdleCallback === "function") {
      usesIdleCallback = true;
      handle = window.requestIdleCallback(runChunk, { timeout: 100 });
    } else {
      usesIdleCallback = false;
      handle = window.setTimeout(() => runChunk(), 0);
    }
  };
  if (firstChunkNow) runChunk();
  else queueChunk();
  return {
    cancel: () => {
      cancelled = true;
      if (!handle) return;
      if (usesIdleCallback && typeof window.cancelIdleCallback === "function")
        window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      handle = 0;
    },
  };
};
