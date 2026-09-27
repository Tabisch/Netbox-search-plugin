import { searchApi } from "./api.js";
import { ALL, OBJECT_TYPES } from "./netbox.js";
import { findInstance, getSettings, getTokens, hasApiAccess } from "./settings.js";

const form = document.getElementById("form");
const query = document.getElementById("query");
const instanceSelect = document.getElementById("instance");
const typeSelect = document.getElementById("type");
const resultsList = document.getElementById("results");
const message = document.getElementById("message");
const hint = document.getElementById("hint");

const DEBOUNCE_MS = 250;

const settings = await getSettings();
const tokens = await getTokens();
// Remember the last choices for this browser only.
const { popupInstanceId, popupType } = await chrome.storage.local.get(["popupInstanceId", "popupType"]);

for (const instance of settings.instances) {
  instanceSelect.add(new Option(instance.name, instance.id));
}
instanceSelect.value = findInstance(settings, popupInstanceId)?.id ?? "";
instanceSelect.hidden = settings.instances.length < 2;

typeSelect.add(new Option(settings.smartDetect ? "All (auto-detect)" : "All objects", ALL));
for (const type of OBJECT_TYPES) typeSelect.add(new Option(type.label, type.key));
typeSelect.value = OBJECT_TYPES.some((t) => t.key === popupType) ? popupType : ALL;

function selectedInstance() {
  return findInstance(settings, instanceSelect.value);
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? "error" : "";
}

// --- Live results -------------------------------------------------------

let active = -1;
let controller = null;
let timer = null;

function links() {
  return [...resultsList.querySelectorAll("a")];
}

function setActive(index) {
  const items = links();
  active = items.length ? (index + items.length) % items.length : -1;
  items.forEach((a, i) => {
    a.classList.toggle("active", i === active);
    a.setAttribute("aria-selected", String(i === active));
  });
  items[active]?.scrollIntoView({ block: "nearest" });
}

function renderResults(results) {
  resultsList.replaceChildren(
    ...results.map((result) => {
      const title = document.createElement("div");
      title.className = "title";
      const type = document.createElement("span");
      type.className = "type";
      type.textContent = result.typeLabel;
      title.append(result.display, type);
      const detail = document.createElement("div");
      detail.className = "detail";
      detail.textContent = result.detail;
      const link = document.createElement("a");
      link.href = result.url;
      link.role = "option";
      link.append(title, detail);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openUrl(result.url);
      });
      const item = document.createElement("li");
      item.append(link);
      return item;
    }),
  );
  query.setAttribute("aria-expanded", String(results.length > 0));
  active = -1;
}

async function runLiveSearch() {
  controller?.abort();
  const text = query.value.trim();
  const instance = selectedInstance();
  if (!text || !instance || !(await hasApiAccess(settings, instance))) {
    renderResults([]);
    setMessage("");
    return;
  }
  controller = new AbortController();
  const { signal } = controller;
  setMessage("Searching…");
  try {
    const { total, results, errors } = await searchApi(instance.url, tokens[instance.id], text, {
      type: typeSelect.value,
      smart: settings.smartDetect,
      limit: 5,
      signal,
    });
    renderResults(results);
    if (!total) setMessage("No matches. Press Enter to open the NetBox search.");
    else if (errors.length) setMessage(`Some object types could not be searched: ${errors[0].message}`, true);
    else if (total > results.length) setMessage(`Showing ${results.length} of ${total} matches. Press Enter for all.`);
    else setMessage("");
  } catch (error) {
    if (error.name === "AbortError") return;
    renderResults([]);
    setMessage(error.message, true);
  }
}

function scheduleLiveSearch() {
  clearTimeout(timer);
  timer = setTimeout(runLiveSearch, DEBOUNCE_MS);
}

// --- Actions ------------------------------------------------------------

async function openUrl(url) {
  await chrome.tabs.create({ url, active: !settings.openInBackground });
  window.close();
}

function updateHint() {
  const instance = selectedInstance();
  hint.textContent = instance ? instance.url : "No instance configured";
  hint.title = hint.textContent;
}
updateHint();

instanceSelect.addEventListener("change", () => {
  updateHint();
  runLiveSearch();
});
typeSelect.addEventListener("change", runLiveSearch);
query.addEventListener("input", scheduleLiveSearch);

query.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActive(active + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Escape" && active >= 0) {
    event.preventDefault();
    setActive(-1);
  }
});

document.getElementById("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (active >= 0) {
    await openUrl(links()[active].href);
    return;
  }
  if (!query.value.trim() && settings.instances.length) return;
  await chrome.storage.local.set({ popupInstanceId: instanceSelect.value, popupType: typeSelect.value });
  // The background worker opens the tab, so the popup can close immediately
  // even if it first checks the API for a single match.
  await chrome.runtime.sendMessage({
    action: "search",
    query: query.value,
    instanceId: instanceSelect.value,
    type: typeSelect.value,
  });
  window.close();
});
