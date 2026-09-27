import { ALL, OBJECT_TYPES } from "./netbox.js";
import { getSettings, hostOf, searchNetBox } from "./settings.js";

const CONFIGURE_ID = "configure";
const SEP = "|";

function instanceLabel(instance) {
  return instance.name || hostOf(instance.url);
}

// Menu item ids are "<instanceId>|<type>" so the click handler needs no state.
async function buildContextMenu() {
  const settings = await getSettings();
  await chrome.contextMenus.removeAll();

  if (!settings.instances.length) {
    chrome.contextMenus.create({
      id: CONFIGURE_ID,
      title: "Search NetBox: set up an instance…",
      contexts: ["selection"],
    });
    return;
  }

  const types = OBJECT_TYPES.filter((t) => settings.menuTypes.includes(t.key));
  // With more than one top-level item Chrome nests them under the extension
  // name, so each instance gets its own submenu.
  for (const instance of settings.instances) {
    const parentId = `${instance.id}${SEP}parent`;
    chrome.contextMenus.create({
      id: parentId,
      title: `Search ${instanceLabel(instance)} for "%s"`,
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: `${instance.id}${SEP}${ALL}`,
      parentId,
      title: settings.smartDetect ? "All objects (auto-detect)" : "All objects",
      contexts: ["selection"],
    });
    if (!types.length) {
      continue;
    }
    chrome.contextMenus.create({
      id: `${instance.id}${SEP}separator`,
      parentId,
      type: "separator",
      contexts: ["selection"],
    });
    for (const type of types) {
      chrome.contextMenus.create({
        id: `${instance.id}${SEP}${type.key}`,
        parentId,
        title: type.label,
        contexts: ["selection"],
      });
    }
  }
}

// Serialize rebuilds so overlapping storage events can't create duplicate ids.
let rebuilding = Promise.resolve();
function rebuildContextMenu() {
  rebuilding = rebuilding.then(buildContextMenu).catch((error) => console.error(error));
  return rebuilding;
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await rebuildContextMenu();
  if (reason === "install") {
    const { instances } = await getSettings();
    if (!instances.length) {
      chrome.runtime.openOptionsPage();
    }
  }
});

chrome.runtime.onStartup.addListener(rebuildContextMenu);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    rebuildContextMenu();
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONFIGURE_ID) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const [instanceId, type] = String(info.menuItemId).split(SEP);
  if (info.selectionText?.trim()) {
    searchNetBox(info.selectionText, { instanceId, type });
  }
});

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
