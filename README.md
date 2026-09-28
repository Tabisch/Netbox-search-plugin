# NetBox Search – Chrome extension

Search a [NetBox](https://github.com/netbox-community/netbox) instance straight from your browser.

## Features

- **Context menu:** highlight text on any page, right-click, choose
  **Search *instance* for "…"**, then **All objects** or a specific object type
  (devices, IP addresses, prefixes, VLANs, circuits, …). Which types appear is configurable.
- **Multiple instances:** configure any number of NetBox instances (e.g. production,
  staging, lab), each with an optional name and path prefix such as
  `https://example.com/netbox`. One of them is the default.
- **Auto-detection:** an "All objects" search for an IP address, prefix, MAC address or
  ASN opens the matching filtered list instead of the global search:

  | Selection            | Opens                                         |
  | -------------------- | --------------------------------------------- |
  | `10.0.0.1`           | `/ipam/ip-addresses/?address=10.0.0.1`        |
  | `10.0.0.1/24`        | `/ipam/ip-addresses/?address=10.0.0.1/24`     |
  | `10.0.0.0/24`        | `/ipam/prefixes/?prefix=10.0.0.0/24`          |
  | `2001:db8::/48`      | `/ipam/prefixes/?prefix=2001:db8::/48`        |
  | `00:1a:2b:3c:4d:5e`, `001a.2b3c.4d5e` | `/dcim/interfaces/?mac_address=00:1A:2B:3C:4D:5E` |
  | `AS65001`            | `/ipam/asns/?asn=65001`                       |
  | anything else        | `/search/?q=…`                                |

  Picking a specific object type uses that list's search (`/dcim/devices/?q=…`).
  Auto-detection can be turned off in the options.
- **Toolbar popup:** click the extension icon, pick the instance and object type, and type a
  query. The last choices are remembered.
- **Address bar:** type `nb`, press <kbd>Space</kbd> or <kbd>Tab</kbd>, then enter your query.
  Enter searches the default instance; other instances appear as suggestions.
- **Link search:** right-click a link and choose **Search *instance* for link text**. If the link
  has no usable text (e.g. an icon), the link's host name is searched instead.
- Optionally open results in a background tab.

### NetBox API features (optional)

These read data through the NetBox REST API. Turn them on under **NetBox API** in the options.
Chrome then asks for access to your instance URLs. Authentication uses the per-instance
**API token** (stored only on this device, never synced), or your NetBox login session in this
browser if no token is set. Both NetBox v1 tokens and v2 (`nbt_…`) tokens work. The **Test**
button next to each instance checks the URL and token.

- **Live results:** the toolbar popup shows matches as you type (name, type, status, site, …).
  Use <kbd>↑</kbd>/<kbd>↓</kbd> and <kbd>Enter</kbd> to open one, or press <kbd>Enter</kbd> with
  nothing highlighted to open the full search.
- **Open single matches directly:** when a search from the context menu, popup or address bar
  has exactly one match, the object's page opens instead of the results list. If the API is
  slow (over 3 seconds) or fails, the normal search page opens.
- **Selection preview:** select short text on any web page to see a card with NetBox matches
  from the default instance. This asks for access to all websites, because it runs a small
  script on every page. Selected text is only sent to your NetBox instance. The preview is off
  by default and doesn't run on your NetBox instances themselves.

## Installation (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. The options page opens on first install. Enter your NetBox URL(s) and click **Save**.
   You can reopen it later from the extension's **Options** menu entry or the popup.

You need to be logged in to NetBox in the same browser profile, because the extension
uses your normal NetBox web session.

## Layout

```
manifest.json      Manifest V3 definition
src/background.js  Service worker: context menus, omnibox, single-match lookup, preview requests
src/api.js         NetBox REST API client (no chrome APIs)
src/preview.js     Content script for the selection preview (only registered when enabled)
src/netbox.js      NetBox URL building and IP/prefix/MAC/ASN detection (no chrome APIs)
src/settings.js    Settings storage, migration, URL normalization and search helper
src/options.*      Options page (instances, detection, menu object types)
src/popup.*        Toolbar popup search box
src/style.css      Shared styles (light and dark mode)
icons/             Extension icons
test/              Unit tests for src/netbox.js and src/api.js
```

## Development

Run the unit tests with Node 20 or newer (no dependencies needed):

```
npm test
```

Check code style (braces on every `if`/`for`/`else`, block contents on their own lines):

```
npm install
npm run lint
```

After changing files, click the reload icon for the extension on `chrome://extensions`.
Settings from version 1.0 (a single instance URL) are migrated automatically.

## Permissions

- `contextMenus`: adds the "Search NetBox" entries for selected text and links.
- `storage`: saves your settings (synced across your Chrome profile) and API tokens (this device only).
- `activeTab` and `scripting`: read the text of a right-clicked link, and register the selection
  preview script when it's enabled.
- Optional host access: your NetBox instance URLs for the API features, and all websites for the
  selection preview. Chrome asks when you turn these on, and access is returned when you turn the
  API features off.

Without the API features, the extension doesn't make network requests on its own; it only opens
tabs with search URLs.
