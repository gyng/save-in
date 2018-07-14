/*
 license: The MIT License, Copyright (c) 2016-2018 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-l10n
*/

var l10n = {
  updateString(aString) {
    return aString.replace(/__MSG_(.+?)__/g, (aMatched) => {
      const key = aMatched.slice(6, -2);
      return chrome.i18n.getMessage(key) || aMatched;
    });
  },

  $log(aMessage, ...aArgs) {
    aMessage = `l10s: ${aMessage}`;
    if (typeof window.log === 'function')
      log(aMessage, ...aArgs);
    else
      console.log(aMessage, ...aArgs);
  },

  updateDocument() {
    const texts = document.evaluate(
      'descendant::text()[contains(self::text(), "__MSG_")]',
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++) {
      const text = texts.snapshotItem(i);
      text.nodeValue = this.updateString(text.nodeValue);
    }

    const attributes = document.evaluate(
      'descendant::*/attribute::*[contains(., "__MSG_")]',
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++) {
      const attribute = attributes.snapshotItem(i);
      this.$log('apply', attribute);
      attribute.value = this.updateString(attribute.value);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  l10n.updateDocument();
}, { once: true });
