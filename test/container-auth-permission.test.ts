import { createContainerAuthPermission } from "../src/options/container-auth-permission.ts";

const makeCheckbox = () => {
  const listeners: Record<string, () => void> = {};
  const checkbox = {
    checked: false,
    disabled: false,
    addEventListener: (type: string, listener: () => void) => {
      listeners[type] = listener;
    },
    change: (checked: boolean) => {
      checkbox.checked = checked;
      listeners.change?.();
    },
  };
  return checkbox;
};

describe("Firefox Container authentication permission", () => {
  const createApi = (granted = false) => {
    let current = granted;
    const api = {
      permissions: {
        contains: vi.fn(() => Promise.resolve(current)),
        request: vi.fn(() => {
          current = true;
          return Promise.resolve(true);
        }),
        remove: vi.fn(() => {
          current = false;
          return Promise.resolve(true);
        }),
        onAdded: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
      },
    };
    return api;
  };

  test("reflects whether the optional cookies permission is granted", async () => {
    const api = createApi(true);
    const checkbox = makeCheckbox();

    await createContainerAuthPermission(api).init(checkbox, null);

    expect(checkbox.checked).toBe(true);
    expect(api.permissions.contains).toHaveBeenCalledWith({ permissions: ["cookies"] });
  });

  test("requests and removes permission directly from the user's change gesture", async () => {
    const api = createApi(false);
    const checkbox = makeCheckbox();
    await createContainerAuthPermission(api).init(checkbox, null);

    checkbox.change(true);
    expect(api.permissions.request).toHaveBeenCalledWith({ permissions: ["cookies"] });
    await vi.waitFor(() => expect(checkbox.checked).toBe(true));

    checkbox.change(false);
    expect(api.permissions.remove).toHaveBeenCalledWith({ permissions: ["cookies"] });
    await vi.waitFor(() => expect(checkbox.checked).toBe(false));
  });

  test("reverts the checkbox when permission is denied", async () => {
    const api = createApi(false);
    api.permissions.request.mockResolvedValueOnce(false);
    const checkbox = makeCheckbox();
    await createContainerAuthPermission(api).init(checkbox, null);

    checkbox.change(true);

    await vi.waitFor(() => expect(checkbox.checked).toBe(false));
  });
});
