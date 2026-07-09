// Substitutes __MSG_key__ placeholders in the options document with i18n
// messages. First-party replacement for webextensions-lib-l10n.

const localizeString = (str) =>
  str.replace(/__MSG_(.+?)__/g, (match, key) => chrome.i18n.getMessage(key) || match);

const localizeDocument = () => {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes("__MSG_")) {
      texts.push(walker.currentNode);
    }
  }
  texts.forEach((node) => {
    node.nodeValue = localizeString(node.nodeValue);
  });

  document.querySelectorAll("*").forEach((el) => {
    for (const attr of el.attributes) {
      if (attr.value.includes("__MSG_")) {
        attr.value = localizeString(attr.value);
      }
    }
  });
};

document.addEventListener("DOMContentLoaded", localizeDocument, { once: true });

// Export for testing
if (typeof module !== "undefined") {
  module.exports = { localizeString, localizeDocument };
}
