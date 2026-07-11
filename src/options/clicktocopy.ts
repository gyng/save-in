export const addClickToCopy = (el: HTMLElement): void => {
  let clicked: HTMLElement | null = null;

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
      e.clipboardData.setData("text/plain", el.textContent ?? "");
      clicked = null;
    }
  });
};

document.querySelectorAll<HTMLElement>(".click-to-copy").forEach(addClickToCopy);
