const addClickToCopy = el => {
  let clicked;

  el.title = `Click to copy ${el.textContent} to clipboard`; // eslint-disable-line

  el.addEventListener("click", () => {
    clicked = el;
    document.execCommand("copy");
  });

  document.addEventListener("copy", e => {
    if (clicked !== el) {
      return;
    }

    e.preventDefault();
    if (e.clipboardData) {
      e.clipboardData.setData("text/plain", el.textContent);
      clicked = null;
    }
  });
};

document.querySelectorAll(".click-to-copy").forEach(addClickToCopy);
