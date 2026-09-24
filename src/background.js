import { getSettings, searchNetBox } from "./settings.js";

const MENU_ID = "netbox-search-selection";

async function hostLabel() {
  const { instanceUrl } = await getSettings();
  if (!instanceUrl) return "NetBox";
  try {
    return `NetBox (${new URL(instanceUrl).host})`;
  } catch {
    return "NetBox";
  }
}

async function setupContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: `Search ${await hostLabel()} for "%s"`,
    contexts: ["selection"],
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setupContextMenu();
  if (reason === "install") {
    const { instanceUrl } = await getSettings();
    if (!instanceUrl) chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(setupContextMenu);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.instanceUrl) {
    chrome.contextMenus.update(MENU_ID, {
      title: `Search ${await hostLabel()} for "%s"`,
    });
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.selectionText?.trim()) {
    searchNetBox(info.selectionText);
  }
});

// Address bar: type "nb", press Tab/Space, then the search term.
chrome.omnibox.onInputStarted.addListener(async () => {
  const label = await hostLabel();
  chrome.omnibox.setDefaultSuggestion({ description: `Search ${label} for: %s` });
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  if (text.trim()) searchNetBox(text, { disposition });
});
