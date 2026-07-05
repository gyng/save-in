const addClickToCopy = (el) => {
  let clicked;

  el.title = `Click to copy ${el.textContent} to clipboard`; // eslint-disable-line
  el.setAttribute("role", "button");

  const copy = () => {
    clicked = el;
    document.execCommand("copy");
  };

  el.addEventListener("click", copy);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copy();
    }
  });

  document.addEventListener("copy", (e) => {
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
