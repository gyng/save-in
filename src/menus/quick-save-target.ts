import { Path } from "../routing/path.ts";

export type QuickSaveTargetOptions = {
  quickSaveDirectory: string;
  quickSaveUseDirectory: boolean;
};

// The effective Quick save (default) destination. "." is the Downloads root and
// the behavior that existed before the dynamic-default option, so the toggle
// being off — or absent from an older stored profile — keeps that behavior. A
// configured directory only applies when the user both set it and turned the
// toggle on, and an unparseable path falls back to "." so a corrupt profile
// value can never silently divert saves to an unexpected location.
export const resolveDefaultDestination = (options: QuickSaveTargetOptions): string => {
  if (!options.quickSaveUseDirectory) return ".";
  const directory = options.quickSaveDirectory.trim();
  if (!directory || !new Path(directory).validate().valid) return ".";
  return directory;
};
