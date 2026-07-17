// Experimental WebMCP host surface, not yet present in lib.dom.
interface ModelContext {
  registerTool: (tool: { name: string }) => unknown;
}

interface Document {
  modelContext?: ModelContext;
}

interface Navigator {
  modelContext?: ModelContext;
}
