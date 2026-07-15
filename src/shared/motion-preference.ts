type MatchMotionPreference = (query: string) => { matches: boolean };

const hostMotionPreference = (): MatchMotionPreference | undefined => {
  const matchMedia: unknown = Reflect.get(globalThis, "matchMedia");
  if (typeof matchMedia !== "function") return undefined;
  return (query) => Reflect.apply(matchMedia, globalThis, [query]) as { matches: boolean };
};

export const preferredScrollBehavior = (
  matchMotionPreference: MatchMotionPreference | undefined = hostMotionPreference(),
): "auto" | "smooth" =>
  matchMotionPreference?.("(prefers-reduced-motion: reduce)").matches === true ? "auto" : "smooth";
