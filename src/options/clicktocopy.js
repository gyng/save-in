// @ts-check

const addClickToCopy = (/** @type {HTMLElement} */ el) => {
  /**
   * @type {HTMLElement | null}
   */
  let clicked;

  el.title = `Click to copy ${el.textContent} to clipboard`; // eslint-disable-line

  el.addEventListener("click", () => {
    clicked = el;
    document.execCommand("copy");
  });

  document.addEventListener("copy", (e) => {
    if (clicked !== el) {
      return;
    }

    e.preventDefault();
    if (e.clipboardData) {
      // @ts-ignore
      e.clipboardData.setData("text/plain", el.textContent);
      clicked = null;
    }
  });
};

// @ts-ignore
document.querySelectorAll(".click-to-copy").forEach(addClickToCopy);
