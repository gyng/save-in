const getKeywords = browser.runtime
  .sendMessage({ type: "GET_KEYWORDS" })
  .then((res) => res.body)
  .then((keywords) => ({
    matchers: keywords.matchers.sort(),
    variables: keywords.variables.sort(),
  }));

const matcherStrategy = (matcherList) => ({
  id: "matchers",
  match: /(^|\n)([a-z]+)$/,
  search: (term, callback) => {
    callback(matcherList.filter((name) => name.startsWith(term)));
  },
  template: (name) => `${name}:`,
  replace: (name) => `$1${name}: `,
});

const routerVariableStrategy = (variableList) => ({
  id: "routerVariables",
  match: /(\ninto:.*)(:[a-z]+)$/,
  search: (term, callback) => {
    callback(variableList.filter((name) => name.startsWith(term)));
  },
  template: (name) => name,
  replace: (name) => `$1${name}`,
});

const pathVariableStrategy = (variableList) => ({
  id: "pathVariables",
  match: /(.*)(:[a-z]+)$/,
  search: (term, callback) => {
    callback(variableList.filter((name) => name.startsWith(term)));
  },
  template: (name) => name,
  replace: (name) => `$1${name}`,
});

const setupRoutingAutocomplete = (keywords) => {
  const dropdownOptions = {
    dropdown: {
      maxCount: Infinity,
    },
  };

  const pathTextarea = document.getElementById("paths");
  const pathEditor = new window.Textcomplete.editors.Textarea(pathTextarea);
  const pathTextcomplete = new window.Textcomplete(pathEditor, dropdownOptions);
  pathTextcomplete.register([pathVariableStrategy(keywords.variables)]);

  const routerTextarea = document.getElementById("filenamePatterns");
  const routerEditor = new window.Textcomplete.editors.Textarea(routerTextarea);
  const routerTextcomplete = new window.Textcomplete(
    routerEditor,
    dropdownOptions
  );
  routerTextcomplete.register([
    matcherStrategy([...keywords.matchers, "into"]),
    routerVariableStrategy(keywords.variables),
  ]);
};

document.addEventListener("load", getKeywords.then(setupRoutingAutocomplete));
