import type { PageSource, SourcePanelOptions } from "./source-panel-model.ts";

export const PANEL_HOST_ID = "save-in-source-panel";

export const panelCleanups = new WeakMap<Element, () => void>();
const panelCloseTimers = new WeakMap<Element, number>();
export const panelPreviousFocus = new WeakMap<Element, HTMLElement>();
export const panelRoots = new WeakMap<HTMLElement, ShadowRoot>();
export const panelOpenChanges = new WeakMap<HTMLElement, (open: boolean) => void>();
export type SourcePanelDownload = (source: PageSource) => void | boolean | Promise<void | boolean>;
export const panelUpdates = new WeakMap<
  HTMLElement,
  (sendDownload: SourcePanelDownload, options: SourcePanelOptions) => void
>();

export let activePanelHost: HTMLElement | null = null;
export const setActivePanelHost = (host: HTMLElement | null) => {
  activePanelHost = host;
};

export const getSourcePanelHostForTesting = (): HTMLElement | null => activePanelHost;

export const cleanupPanelHost = (host: HTMLElement) => {
  panelCleanups.get(host)?.();
  panelCleanups.delete(host);
  panelPreviousFocus.delete(host);
  panelRoots.delete(host);
  panelOpenChanges.delete(host);
  panelUpdates.delete(host);
  if (activePanelHost === host) activePanelHost = null;
};

export const cancelPanelRemoval = (host: Element) => {
  const timer = panelCloseTimers.get(host);
  if (timer !== undefined) window.clearTimeout(timer);
  panelCloseTimers.delete(host);
};

const schedulePanelRemoval = (host: HTMLElement) => {
  cancelPanelRemoval(host);
  panelCloseTimers.set(
    host,
    window.setTimeout(() => {
      panelCloseTimers.delete(host);
      cleanupPanelHost(host);
      host.remove();
    }, 90),
  );
};

export const closePanelHost = (host: HTMLElement): false => {
  if (host.classList.contains("closing")) return false;
  panelPreviousFocus.get(host)?.focus();
  host.classList.add("closing");
  schedulePanelRemoval(host);
  panelOpenChanges.get(host)?.(false);
  return false;
};
