interface OptionError {
  message: string;
  error: string;
  warning?: boolean;
}

// The background entry aliases `window` to the Chrome service worker global;
// Firefox and the options page use a real Window.
interface Window {
  SI_DEBUG?: boolean | number;
  ready?: Promise<unknown>;
  init: () => Promise<unknown>;
  reset: () => Promise<unknown>;
  optionErrors: {
    paths: OptionError[];
    filenamePatterns: OptionError[];
  };
  lastDownloadState?: import("../src/download-types.ts").DownloadPipelineState | null;
  confirmPendingChanges?: () => boolean | Promise<boolean>;
}

// Experimental WebMCP host surface, not yet present in lib.dom.
interface ModelContext {
  registerTool: (tool: any) => any;
  [key: string]: any;
}

interface Document {
  modelContext?: ModelContext;
}

interface Navigator {
  modelContext?: ModelContext;
}
