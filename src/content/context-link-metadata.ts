import {
  MAX_CONTEXT_LINK_URL_LENGTH,
  boundedContextLinkValue,
  type ContextLinkMetadata,
} from "../shared/context-link-metadata.ts";

const anchorFromEvent = (event: MouseEvent): HTMLAnchorElement | null => {
  const pathAnchor = event
    .composedPath()
    .find((candidate): candidate is HTMLAnchorElement => candidate instanceof HTMLAnchorElement);
  if (pathAnchor) return pathAnchor;
  return event.target instanceof Element
    ? event.target.closest<HTMLAnchorElement>("a[href]")
    : null;
};

export const contextLinkMetadataFromEvent = (event: MouseEvent): ContextLinkMetadata | null => {
  const anchor = anchorFromEvent(event);
  const href = anchor?.href;
  if (!anchor || !href || href.length > MAX_CONTEXT_LINK_URL_LENGTH) return null;
  const title = boundedContextLinkValue(anchor.getAttribute("title"));
  const download = boundedContextLinkValue(anchor.getAttribute("download"));
  return {
    href,
    ...(title ? { title } : {}),
    ...(download ? { download } : {}),
  };
};
