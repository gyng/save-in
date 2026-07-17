import { createDownloadRuntimeState } from "./download-runtime-state.ts";

// url -> state for in-flight downloads, so onDeterminingFilename can
// attribute the right state when two Chrome downloads overlap. This is the
// one shared singleton; download.ts, download-plan.ts, and
// download-execution.ts each mutate it directly, so it lives in its own
// module rather than under any one of them (mirrors download-state.ts vs.
// download-state-instances.ts).
export const downloadRuntime = createDownloadRuntimeState();
