export type PersistenceContext = {
  area: "local" | "session";
  operation: "read" | "write" | "remove" | "update" | "migrate";
  key: string;
};

export type PersistenceFailure = PersistenceContext & {
  at: string;
  error: string;
};

const LIMIT = 50;
const failures: PersistenceFailure[] = [];

const describeError = (error: unknown): string => {
  const description = String(error);
  return description.length > 500 ? `${description.slice(0, 500)}…` : description;
};

export const recordPersistenceFailure = (
  context: PersistenceContext,
  error: unknown,
): PersistenceFailure => {
  const failure = {
    ...context,
    at: new Date().toISOString(),
    error: describeError(error),
  };
  failures.push(failure);
  if (failures.length > LIMIT) failures.splice(0, failures.length - LIMIT);
  return failure;
};

export const getPersistenceDiagnostics = (): PersistenceFailure[] =>
  failures.map((failure) => ({ ...failure }));

export const clearPersistenceDiagnostics = (): void => {
  failures.length = 0;
};
