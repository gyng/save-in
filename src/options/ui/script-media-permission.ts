import { webExtensionApi } from "../../platform/web-extension-api.ts";

// Gates the opt-in "detect media loaded by scripts" toggle on the optional
// webRequest permission. The default install never holds it, so the feature —
// and the network observation it enables — is impossible until the user turns
// the toggle on and grants the permission from that click. permissions.request
// must run synchronously inside the gesture handler (no await before it), so
// the change listener requests first and only reverts on denial. Revoking the
// permission (browser settings) or denying the prompt turns the toggle back
// off through the normal autosave path, so the stored option can never claim a
// permission the extension does not hold.

// A minimal local view of permissions.* — the host declarations narrow the
// permission-array element to a literal union that does not admit "webRequest"
// from an untyped array, so this platform-gap adapter keeps the cast local.
type WebRequestPermission = { permissions: string[] };
type PermissionsApi = {
  contains(permission: WebRequestPermission): Promise<boolean>;
  request(permission: WebRequestPermission): Promise<boolean>;
  remove?(permission: WebRequestPermission): Promise<boolean>;
  onRemoved?: { addListener(listener: () => void): void };
};

const WEBREQUEST_PERMISSION: WebRequestPermission = { permissions: ["webRequest"] };

const permissionsApi = (): PermissionsApi | undefined => {
  const api = (webExtensionApi as { permissions?: unknown }).permissions;
  if (!api || typeof (api as PermissionsApi).request !== "function") return undefined;
  return api as PermissionsApi;
};

// Resolves true when the extension holds webRequest, or when the permissions
// API is unavailable (old engines) — there we never fight a toggle we cannot
// verify.
const hasWebRequest = (): Promise<boolean> => {
  const api = permissionsApi();
  if (!api || !api.contains) return Promise.resolve(true);
  return api.contains(WEBREQUEST_PERMISSION).then(
    (granted) => granted,
    () => true,
  );
};

export const initScriptMediaPermission = (checkbox: HTMLInputElement | null): Promise<void> => {
  if (!checkbox) return Promise.resolve();
  const api = permissionsApi();

  // Turn the toggle off and let the shared autosave listener persist it.
  const revert = (): void => {
    if (!checkbox.checked) return;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  };

  checkbox.addEventListener("change", () => {
    if (!api) return; // no permissions API: leave as-is
    if (!checkbox.checked) {
      // Drop the permission when the feature is turned off so the background
      // listener tears down and re-enabling asks for consent again.
      if (api.remove) void api.remove(WEBREQUEST_PERMISSION).catch(() => {});
      return;
    }
    api.request(WEBREQUEST_PERMISSION).then(
      (granted) => {
        if (!granted) revert();
      },
      () => revert(),
    );
  });

  if (api && api.onRemoved) {
    api.onRemoved.addListener(() => {
      hasWebRequest().then((granted) => {
        if (!granted) revert();
      });
    });
  }

  // Self-heal a stored "on" whose permission was revoked out of band.
  return hasWebRequest().then((granted) => {
    if (!granted) revert();
  });
};

export const setupScriptMediaPermission = (): Promise<void> =>
  initScriptMediaPermission(document.querySelector<HTMLInputElement>("#sourcePanelScriptMedia"));
