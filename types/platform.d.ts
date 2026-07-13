interface Window {
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
