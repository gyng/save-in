import { webExtensionApi } from "../platform/web-extension-api.ts";
import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";

type PermissionApi = {
  permissions?: {
    contains?: (permissions: browser.permissions.Permissions) => Promise<boolean>;
    request?: (permissions: browser.permissions.Permissions) => Promise<boolean>;
    remove?: (permissions: browser.permissions.Permissions) => Promise<boolean>;
  };
  i18n?: { getMessage: (key: string) => string };
};

type PermissionCheckbox = {
  checked: boolean;
  disabled: boolean;
  addEventListener: (type: "change", listener: () => void) => void;
};

type PermissionStatus = { textContent: string | null };

const REQUEST: browser.permissions.Permissions = { permissions: ["cookies"] };

export const createContainerAuthPermission = (api: PermissionApi) => ({
  init: async (
    checkbox: PermissionCheckbox | null,
    status: PermissionStatus | null,
  ): Promise<void> => {
    if (!checkbox) return;
    const permissions = api.permissions;
    if (!permissions?.contains || !permissions.request || !permissions.remove) {
      checkbox.checked = false;
      checkbox.disabled = true;
      return;
    }

    const refresh = async () => {
      let granted = false;
      try {
        granted = (await permissions.contains!(REQUEST)) === true;
      } catch {
        granted = false;
      }
      checkbox.checked = granted;
      if (status) {
        status.textContent =
          api.i18n?.getMessage(granted ? "o_lContainerAuthEnabled" : "o_lContainerAuthDisabled") ||
          (granted ? "Enabled" : "Disabled");
      }
    };

    checkbox.addEventListener("change", () => {
      // permissions.request must be entered directly from the user gesture.
      const operation = checkbox.checked
        ? permissions.request!(REQUEST)
        : permissions.remove!(REQUEST);
      void Promise.resolve(operation).then(refresh, refresh);
    });

    await refresh();
  },
});

export const setupContainerAuthPermission = () => {
  if (CURRENT_BROWSER !== BROWSERS.FIREFOX) return Promise.resolve();
  return createContainerAuthPermission(webExtensionApi).init(
    document.querySelector<HTMLInputElement>("#containerAuthPermission"),
    document.querySelector<HTMLElement>("#containerAuthPermissionStatus"),
  );
};
