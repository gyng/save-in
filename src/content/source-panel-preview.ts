import type { SourcePanelContext } from "./source-panel-context.ts";

/** Lazy preview loading: images/videos only get a real `src` once their row
 * scrolls into view. */
export const wirePanelPreview = (ctx: SourcePanelContext): void => {
  const pendingPreviewSources = new WeakMap<Element, string>();
  const previewObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (
                !entry.isIntersecting ||
                (!(entry.target instanceof HTMLImageElement) &&
                  !(entry.target instanceof HTMLMediaElement))
              )
                return;
              const source = pendingPreviewSources.get(entry.target);
              if (source === undefined) {
                observer.unobserve(entry.target);
                return;
              }
              entry.target.src = source;
              pendingPreviewSources.delete(entry.target);
              observer.unobserve(entry.target);
            });
          },
          { root: ctx.list, rootMargin: "200px" },
        )
      : null;
  ctx.queuePreview = (preview, source) => {
    if (!previewObserver) {
      preview.src = source;
      return;
    }
    pendingPreviewSources.set(preview, source);
    previewObserver.observe(preview);
  };
  ctx.observeExistingPreview = (preview) => {
    if (previewObserver && !preview.hasAttribute("src")) previewObserver.observe(preview);
  };
  ctx.resetPreviewObservations = () => previewObserver?.disconnect();
  ctx.cleanupTasks.push(() => previewObserver?.disconnect());
};
