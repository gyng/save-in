type FieldStatus = "dirty" | "saving" | "failed";
type FieldState = { generation: number; status: FieldStatus };

export const createFieldSaveState = () => {
  const fields = new Map<string, FieldState>();
  const savingTokens = new Set<number>();
  let generation = 0;
  const markDirty = (id: string) => fields.set(id, { generation: ++generation, status: "dirty" });
  const begin = (id: string) => {
    const token = ++generation;
    fields.set(id, { generation: token, status: "saving" });
    savingTokens.add(token);
    return token;
  };
  const settle = (id: string, token: number, status?: FieldStatus) => {
    savingTokens.delete(token);
    if (fields.get(id)?.generation !== token) return false;
    if (status) fields.set(id, { generation: token, status });
    else fields.delete(id);
    return true;
  };
  return {
    markDirty,
    begin,
    succeed: (id: string, token: number) => settle(id, token),
    fail: (id: string, token: number) => settle(id, token, "failed"),
    hasUnsaved: () => fields.size > 0,
    anySaving: () => savingTokens.size > 0,
    unsavedIds: () => [...fields.keys()],
    clear: () => {
      fields.clear();
      savingTokens.clear();
    },
    status: (id: string) => fields.get(id)?.status,
  };
};
