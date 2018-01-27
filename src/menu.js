const Menus = {
  makeSeparator: (() => {
    let separatorCounter = 0;

    const makeSeparatorInner = contexts => {
      browser.contextMenus.create({
        id: `separator-${separatorCounter}`,
        type: "separator",
        contexts,
        parentId: "save-in-_-_-root"
      });
      separatorCounter += 1;
    };

    return makeSeparatorInner;
  })()
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
