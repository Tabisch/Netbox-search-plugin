import { searchApi } from "./api.js";
import { ALL, OBJECT_TYPES, buildSearchUrl } from "./netbox.js";
import {
  ALL_SITES,
  findInstance,
  getSettings,
  getTokens,
  hasApiAccess,
  hostOf,
  searchNetBox,
} from "./settings.js";

const CONFIGURE_ID = "configure";
const SEP = "|";
// What the menu item searches for: the selected text or a link.
const SELECTION = "sel";
const LINK = "link";

function instanceLabel(instance) {
  return instance.name || hostOf(instance.url);
}

function addTypeItems(parentId, prefix, types, settings, contexts) {
  chrome.contextMenus.create({
    id: `${prefix}${SEP}${ALL}`,
    parentId,
    title: settings.smartDetect ? "All objects (auto-detect)" : "All objects",
    contexts,
  });
  if (!types.length) return;
  chrome.contextMenus.create({ id: `${prefix}${SEP}separator`, parentId, type: "separator", contexts });
  for (const type of types) {
    chrome.contextMenus.create({ id: `${prefix}${SEP}${type.key}`, parentId, title: type.label, contexts });
  }
}

// Menu item ids are "<source>|<instanceId>|<type>" so the click handler
// needs no state.
async function buildContextMenu() {
  const settings = await getSettings();
  await chrome.contextMenus.removeAll();

  if (!settings.instances.length) {
    chrome.contextMenus.create({
      id: CONFIGURE_ID,
      title: "Search NetBox: set up an instance…",
      contexts: ["selection", "link"],
    });
    return;
  }

  const types = OBJECT_TYPES.filter((t) => settings.menuTypes.includes(t.key));
  // With more than one top-level item Chrome nests them under the extension
  // name, so each instance gets its own submenus.
  for (const instance of settings.instances) {
    const label = instanceLabel(instance);

    const selPrefix = `${SELECTION}${SEP}${instance.id}`;
    chrome.contextMenus.create({
      id: `${selPrefix}${SEP}parent`,
      title: `Search ${label} for "%s"`,
      contexts: ["selection"],
    });
    addTypeItems(`${selPrefix}${SEP}parent`, selPrefix, types, settings, ["selection"]);

    const linkPrefix = `${LINK}${SEP}${instance.id}`;
    chrome.contextMenus.create({
      id: `${linkPrefix}${SEP}parent`,
      title: `Search ${label} for link text`,
      contexts: ["link"],
    });
    addTypeItems(`${linkPrefix}${SEP}parent`, linkPrefix, types, settings, ["link"]);
  }
}

// Serialize rebuilds so overlapping storage events can't create duplicate ids.
let rebuilding = Promise.resolve();
function rebuildContextMenu() {
  rebuilding = rebuilding.then(buildContextMenu).catch((error) => console.error(error));
  return rebuilding;
}

// The text of the link that was right-clicked, read from the page (clicking
// our menu item grants activeTab). Falls back to the link's host name.
async function linkQuery(info, tab) {
  let text = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      args: [info.linkUrl],
      func: (href) => {
        const link = [...document.links].find((a) => a.href === href);
        return link ? link.innerText.trim() : "";
      },
    });
    text = result || "";
  } catch {
    // Pages like the Chrome Web Store can't be scripted.
  }
  // Long texts ("Click here to view the device dashboard") make poor queries.
  if (text && text.length <= 100 && !text.includes("\n")) return text;
  try {
    return new URL(info.linkUrl).hostname;
  } catch {
    return "";
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONFIGURE_ID) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const [source, instanceId, type] = String(info.menuItemId).split(SEP);
  const query = source === LINK ? await linkQuery(info, tab) : info.selectionText;
  if (query?.trim()) searchNetBox(query, { instanceId, type });
});

// Hover preview: a content script registered for all sites, only while the
// option is on and the permission is granted.
const PREVIEW_SCRIPT_ID = "preview";

async function syncPreviewScript() {
  const settings = await getSettings();
  const wanted =
    settings.apiEnabled &&
    settings.hoverPreview &&
    settings.instances.length > 0 &&
    (await chrome.permissions.contains({ origins: ALL_SITES }));
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [PREVIEW_SCRIPT_ID] });
  if (wanted && !registered.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: PREVIEW_SCRIPT_ID,
        matches: ["<all_urls>"],
        js: ["src/preview.js"],
        runAt: "document_idle",
        allFrames: false,
      },
    ]);
  } else if (!wanted && registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [PREVIEW_SCRIPT_ID] });
  }
}

let syncing = Promise.resolve();
function queueSync() {
  syncing = syncing.then(syncPreviewScript).catch((error) => console.error(error));
  return syncing;
}

// Short-lived cache so selecting the same text again doesn't hit the API.
const previewCache = new Map();
const PREVIEW_TTL_MS = 60_000;

async function previewLookup(query, senderUrl) {
  const settings = await getSettings();
  if (!settings.hoverPreview) return null;
  const instance = findInstance(settings);
  if (!(await hasApiAccess(settings, instance))) return null;
  // No previews on NetBox itself.
  const onNetBox = (i) => senderUrl === i.url || senderUrl.startsWith(`${i.url}/`);
  if (senderUrl && settings.instances.some(onNetBox)) return null;

  const key = `${instance.id}${SEP}${query}`;
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.time < PREVIEW_TTL_MS) return cached.value;

  const tokens = await getTokens();
  let value;
  try {
    const { total, results } = await searchApi(instance.url, tokens[instance.id], query, {
      smart: settings.smartDetect,
      limit: 3,
    });
    value = total
      ? {
          instanceName: instanceLabel(instance),
          total,
          results: results.slice(0, 5),
          searchUrl: buildSearchUrl(instance.url, query, { smart: settings.smartDetect }),
        }
      : null;
  } catch {
    value = null;
  }
  previewCache.set(key, { time: Date.now(), value });
  return value;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.action === "search") {
    // From the popup, which closes right away; the search (and any API
    // lookup for a single match) continues here.
    searchNetBox(message.query, { instanceId: message.instanceId, type: message.type });
    return false;
  }
  if (message?.action === "preview" && typeof message.query === "string") {
    previewLookup(message.query.trim(), sender.url).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await rebuildContextMenu();
  await queueSync();
  if (reason === "install") {
    const { instances } = await getSettings();
    if (!instances.length) {
      chrome.runtime.openOptionsPage();
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  rebuildContextMenu();
  queueSync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    previewCache.clear();
    rebuildContextMenu();
    queueSync();
  }
  if (area === "local" && changes.tokens) previewCache.clear();
});

chrome.permissions.onAdded.addListener(queueSync);
chrome.permissions.onRemoved.addListener(queueSync);

// Address bar: type "nb", press Tab/Space, then the search term. The default
// instance is used; other instances are offered as suggestions.
function escapeXml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const settings = await getSettings();
  const defaultInstance = settings.instances.find((i) => i.id === settings.defaultInstanceId);
  chrome.omnibox.setDefaultSuggestion({
    description: defaultInstance
      ? `Search ${escapeXml(instanceLabel(defaultInstance))} for: %s`
      : "No NetBox instance configured – press Enter to open the options",
  });
  if (!text.trim()) {
    return suggest([]);
  }
  suggest(
    settings.instances
      .filter((i) => i.id !== settings.defaultInstanceId)
      .map((i) => ({
        content: `${text}${SEP}${i.id}`,
        description: `Search <match>${escapeXml(instanceLabel(i))}</match> for: ${escapeXml(text)}`,
      })),
  );
});

chrome.omnibox.onInputEntered.addListener((input, disposition) => {
  // Suggestions carry the instance id after the last separator.
  const index = input.lastIndexOf(SEP);
  const candidateId = index >= 0 ? input.slice(index + 1) : "";
  const isSuggestion = /^[0-9a-f-]{36}$/.test(candidateId);
  const query = isSuggestion ? input.slice(0, index) : input;
  const instanceId = isSuggestion ? candidateId : undefined;
  if (query.trim()) {
    searchNetBox(query, { instanceId, disposition });
  } else {
    chrome.runtime.openOptionsPage();
  }
});
