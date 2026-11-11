import type { PageSource, SourcePanelOptions } from "./source-panel-model.ts";
import type { PageSourceKind } from "../shared/page-source.ts";

export const PANEL_HOST_ID = "save-in-source-panel";

// Identified by id rather than by the active-host binding so a host left behind
// by an earlier content-script instance is recognized too.
export const isSourcePanelHost = (candidate: unknown): boolean =>
  candidate instanceof Element && candidate.localName === "aside" && candidate.id === PANEL_HOST_ID;

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
// Routes background webRequest media pushes to the live panel instance's merge.
export const panelScriptMedia = new WeakMap<
  HTMLElement,
  (sources: Array<{ url: string; kind: PageSourceKind }>) => void
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
  panelScriptMedia.delete(host);
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
  // Hand focus back only while the panel still holds it. A close the user did
  // not trigger from inside the panel (an option change, a keyboard command, a
  // disable-list transition) must not yank focus out of the page field they
  // have since moved to.
  if (document.activeElement === host) panelPreviousFocus.get(host)?.focus();
  host.classList.add("closing");
  schedulePanelRemoval(host);
  panelOpenChanges.get(host)?.(false);
  return false;
};
