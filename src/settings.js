// Shared helpers for reading settings and opening NetBox searches.

import { ALL, OBJECT_TYPES, buildSearchUrl } from "./netbox.js";

export const DEFAULTS = {
  // [{ id, name, url }]; the entry whose id is defaultInstanceId is used by
  // the address bar and preselected in the popup.
  instances: [],
  defaultInstanceId: null,
  openInBackground: false,
  smartDetect: true,
  // Object types offered in the context menu, in OBJECT_TYPES order.
  menuTypes: ["devices", "ip-addresses", "prefixes", "vlans", "circuits"],
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  const settings = { ...DEFAULTS, ...stored };

  // Version 1.0 stored a single `instanceUrl`.
  if (stored.instanceUrl && !stored.instances) {
    const instance = { id: newId(), name: hostOf(stored.instanceUrl), url: stored.instanceUrl };
    settings.instances = [instance];
    settings.defaultInstanceId = instance.id;
    await chrome.storage.sync.set({ instances: settings.instances, defaultInstanceId: instance.id });
    await chrome.storage.sync.remove("instanceUrl");
  }
  delete settings.instanceUrl;

  if (!settings.instances.some((i) => i.id === settings.defaultInstanceId)) {
    settings.defaultInstanceId = settings.instances[0]?.id ?? null;
  }
  const known = new Set(OBJECT_TYPES.map((t) => t.key));
  settings.menuTypes = settings.menuTypes.filter((key) => known.has(key));
  return settings;
}

export function newId() {
  return crypto.randomUUID();
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function findInstance(settings, id) {
  return (
    settings.instances.find((i) => i.id === id) ||
    settings.instances.find((i) => i.id === settings.defaultInstanceId) ||
    settings.instances[0] ||
    null
  );
}

// Turns user input like "netbox.example.com/" into "https://netbox.example.com".
// Returns null if the value is not a usable http(s) URL.
export function normalizeInstanceUrl(value) {
  let input = (value || "").trim();
  if (!input) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

// Opens a NetBox search, or the options page if no instance is configured.
// `instanceId` falls back to the default instance; `type` is ALL or an
// OBJECT_TYPES key; `disposition` comes from the omnibox.
export async function searchNetBox(query, { instanceId, type = ALL, disposition } = {}) {
  const settings = await getSettings();
  const instance = findInstance(settings, instanceId);
  if (!instance) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  const url = buildSearchUrl(instance.url, query, { type, smart: settings.smartDetect });
  if (disposition === "currentTab") {
    await chrome.tabs.update({ url });
  } else {
    const active = disposition === "newBackgroundTab" ? false : !settings.openInBackground;
    await chrome.tabs.create({ url, active });
  }
}
