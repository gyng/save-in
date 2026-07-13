// Substitutes __MSG_key__ placeholders in the options document with i18n
// messages. First-party replacement for webextensions-lib-l10n.

type GetMessage = (key: string) => string;

const nativeGetMessage: GetMessage = (key) => chrome.i18n.getMessage(key);

export const localizeString = (str: string, getMessage: GetMessage = nativeGetMessage): string =>
  str.replace(/__MSG_(.+?)__/g, (match, key) => getMessage(key) || match);

export const hardenLinks = () => {
  document.querySelectorAll<HTMLAnchorElement>("a.external").forEach((link) => {
    link.target = "_blank";
  });
  document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]').forEach((link) => {
    link.relList.add("noreferrer");
  });
};

export const localizeDocument = (getMessage: GetMessage = nativeGetMessage) => {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const texts: Node[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue?.includes("__MSG_")) {
      texts.push(walker.currentNode);
    }
  }
  texts.forEach((node) => {
    node.nodeValue = localizeString(node.nodeValue ?? "", getMessage);
  });

  document.querySelectorAll("*").forEach((el) => {
    for (const attr of el.attributes) {
      if (attr.value.includes("__MSG_")) {
        attr.value = localizeString(attr.value, getMessage);
      }
    }
  });
  hardenLinks();
};
