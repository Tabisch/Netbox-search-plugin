// Shared helpers for reading settings and building NetBox search URLs.

export const DEFAULTS = {
  instanceUrl: "",
  openInBackground: false,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
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

export function buildSearchUrl(instanceUrl, query) {
  const url = new URL(`${instanceUrl}/search/`);
  url.searchParams.set("q", query.trim());
  return url.href;
}

// Opens a NetBox search for `query`, or the options page if no instance is set.
export async function searchNetBox(query, { disposition } = {}) {
  const { instanceUrl, openInBackground } = await getSettings();
  if (!instanceUrl) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  const url = buildSearchUrl(instanceUrl, query);
  if (disposition === "currentTab") {
    await chrome.tabs.update({ url });
  } else {
    const active = disposition === "newBackgroundTab" ? false : !openInBackground;
    await chrome.tabs.create({ url, active });
  }
}
