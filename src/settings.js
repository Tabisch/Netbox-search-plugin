// Shared helpers for reading settings and opening NetBox searches.

import { searchApi } from "./api.js";
import { ALL, OBJECT_TYPES, buildSearchUrl, detectQuery } from "./netbox.js";

export const DEFAULTS = {
  // [{ id, name, url }]; the entry whose id is defaultInstanceId is used by
  // the address bar and preselected in the popup.
  instances: [],
  defaultInstanceId: null,
  openInBackground: false,
  smartDetect: true,
  // Object types offered in the context menu, in OBJECT_TYPES order.
  menuTypes: ["devices", "ip-addresses", "prefixes", "vlans", "circuits"],
  // NetBox API features. They need host access to the instance, which the
  // options page requests when they are turned on.
  apiEnabled: false,
  jumpToSingleMatch: true,
  // Also needs access to all sites, for the content script.
  hoverPreview: false,
  // Preview in xterm.js terminals (WebSSH); only applies with hoverPreview.
  xtermPreview: true,
};

// Match pattern for chrome.permissions covering an instance.
export function originPattern(url) {
  return `${new URL(url).origin}/*`;
}

export const ALL_SITES = ["http://*/*", "https://*/*"];

// API tokens stay on this device (chrome.storage.local), keyed by instance id.
export async function getTokens() {
  const { tokens } = await chrome.storage.local.get({ tokens: {} });
  return tokens;
}

// Whether API lookups may be made for `instance` right now.
export async function hasApiAccess(settings, instance) {
  if (!settings.apiEnabled || !instance) {
    return false;
  }
  return chrome.permissions.contains({ origins: [originPattern(instance.url)] });
}

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
  if (!input) {
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    input = `https://${input}`;
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
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
  const url = await resolveSearchUrl(settings, instance, query, type);
  if (disposition === "currentTab") {
    await chrome.tabs.update({ url });
  } else {
    const active = disposition === "newBackgroundTab" ? false : !settings.openInBackground;
    await chrome.tabs.create({ url, active });
  }
}

const JUMP_TIMEOUT_MS = 3000;

// The page to open for a search: the object itself when the API finds exactly
// one match (and that option is on), otherwise the search results page. A
// detected IP/prefix/MAC/ASN without matches opens the global search instead.
export async function resolveSearchUrl(settings, instance, query, type = ALL) {
  const smart = settings.smartDetect;
  const url = buildSearchUrl(instance.url, query, { type, smart });
  const detected = smart && type === ALL && detectQuery(query);
  if (!(settings.jumpToSingleMatch || detected) || !(await hasApiAccess(settings, instance))) {
    return url;
  }
  const tokens = await getTokens();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUMP_TIMEOUT_MS);
  try {
    const { total, results, errors, fallback } = await searchApi(instance.url, tokens[instance.id], query, {
      type,
      smart,
      limit: 2,
      signal: controller.signal,
    });
    // With a failed request we can't know the match is unique.
    if (settings.jumpToSingleMatch && total === 1 && results.length === 1 && !errors.length) {
      return results[0].url;
    }
    if (fallback) {
      return buildSearchUrl(instance.url, query, { type });
    }
  } catch {
    // Slow or unreachable API: fall back to the results page.
  } finally {
    clearTimeout(timer);
  }
  return url;
}
