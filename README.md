# NetBox Search – Chrome extension

Search a [NetBox](https://github.com/netbox-community/netbox) instance straight from your browser.

## Features

- **Context menu:** highlight text on any page, right-click, and choose
  **Search NetBox (your-host) for "…"**.
- **Configurable instance:** set your NetBox base URL on the options page,
  including any path prefix, e.g. `https://example.com/netbox`.
- **Toolbar popup:** click the extension icon and type a query.
- **Address bar:** type `nb`, press <kbd>Space</kbd> or <kbd>Tab</kbd>, then enter your query.
- Optionally open results in a background tab.

Searches open NetBox's global search page: `<instance>/search/?q=<query>`.

## Installation (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. The options page opens on first install. Enter your NetBox URL and click **Save**.
   You can reopen it later from the extension's **Options** menu entry or the popup.

You need to be logged in to NetBox in the same browser profile, because the extension
uses your normal NetBox web session.

## Layout

```
manifest.json      Manifest V3 definition
src/background.js  Service worker: context menu and omnibox handling
src/settings.js    Shared settings storage, URL normalization and search helpers
src/options.*      Options page (instance URL, background-tab preference)
src/popup.*        Toolbar popup search box
src/style.css      Shared styles (light and dark mode)
icons/             Extension icons
```

## Permissions

- `contextMenus` – adds the "Search NetBox" entry for selected text.
- `storage` – saves your settings (synced across your Chrome profile).

The extension doesn't read page content or make network requests on its own.
It only opens a tab with the search URL.
