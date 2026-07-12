type FieldStatus = "dirty" | "saving" | "failed";
type FieldState = { generation: number; status: FieldStatus };

export const createFieldSaveState = () => {
  const fields = new Map<string, FieldState>();
  let generation = 0;
  const markDirty = (id: string) => fields.set(id, { generation: ++generation, status: "dirty" });
  const begin = (id: string) => {
    const token = ++generation;
    fields.set(id, { generation: token, status: "saving" });
    return token;
  };
  const settle = (id: string, token: number, status?: FieldStatus) => {
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
    anySaving: () => [...fields.values()].some((field) => field.status === "saving"),
    unsavedIds: () => [...fields.keys()],
    clear: () => fields.clear(),
    status: (id: string) => fields.get(id)?.status,
  };
};
