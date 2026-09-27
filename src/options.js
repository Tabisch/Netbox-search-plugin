import { checkConnection } from "./api.js";
import { OBJECT_TYPES } from "./netbox.js";
import {
  ALL_SITES,
  getSettings,
  getTokens,
  hostOf,
  newId,
  normalizeInstanceUrl,
  originPattern,
} from "./settings.js";

const form = document.getElementById("form");
const list = document.getElementById("instances");
const rowTemplate = document.getElementById("instance-row");
const typesBox = document.getElementById("types");
const smartInput = document.getElementById("smartDetect");
const bgInput = document.getElementById("openInBackground");
const apiInput = document.getElementById("apiEnabled");
const jumpInput = document.getElementById("jumpToSingleMatch");
const previewInput = document.getElementById("hoverPreview");
const status = document.getElementById("status");

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `status ${kind}`;
}

function showRowStatus(row, message, kind) {
  const el = row.querySelector(".row-status");
  el.textContent = message;
  el.className = `row-status status ${kind}`;
}

async function testRow(row) {
  const url = normalizeInstanceUrl(row.querySelector(".url").value);
  if (!url) {
    showRowStatus(row, "Enter a valid http(s) URL first.", "error");
    return;
  }
  // Must be requested straight from the click, before any other await.
  const granted = await chrome.permissions.request({ origins: [originPattern(url)] });
  if (!granted) {
    showRowStatus(row, `Access to ${hostOf(url)} was not granted.`, "error");
    return;
  }
  showRowStatus(row, "Testing…", "");
  try {
    const version = await checkConnection(url, row.querySelector(".token").value, AbortSignal.timeout(10000));
    showRowStatus(row, `Connected to NetBox ${version}.`, "ok");
  } catch (error) {
    const message = error.name === "TimeoutError" ? "The request timed out." : error.message;
    showRowStatus(row, message, "error");
  }
}

function addRow(instance = { id: newId(), name: "", url: "" }, token = "", isDefault = false) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = instance.id;
  row.querySelector(".name").value = instance.name;
  row.querySelector(".url").value = instance.url;
  row.querySelector(".token").value = token;
  const radio = row.querySelector("input[type=radio]");
  radio.checked = isDefault || !list.children.length;
  row.querySelector(".remove").addEventListener("click", () => {
    const wasDefault = radio.checked;
    row.remove();
    if (wasDefault) list.querySelector("input[type=radio]")?.click();
    if (!list.children.length) addRow();
  });
  row.querySelector(".test").addEventListener("click", () => testRow(row));
  list.append(row);
  return row;
}

function updateApiDependents() {
  for (const input of document.querySelectorAll("[data-needs-api]")) {
    input.disabled = !apiInput.checked;
  }
}

const settings = await getSettings();
const tokens = await getTokens();
for (const instance of settings.instances) {
  addRow(instance, tokens[instance.id] ?? "", instance.id === settings.defaultInstanceId);
}
if (!settings.instances.length) addRow().querySelector(".url").focus();
smartInput.checked = settings.smartDetect;
bgInput.checked = settings.openInBackground;
apiInput.checked = settings.apiEnabled;
jumpInput.checked = settings.jumpToSingleMatch;
previewInput.checked = settings.hoverPreview;
updateApiDependents();
apiInput.addEventListener("change", updateApiDependents);

for (const type of OBJECT_TYPES) {
  const label = document.createElement("label");
  label.className = "check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = type.key;
  box.checked = settings.menuTypes.includes(type.key);
  label.append(box, type.label);
  typesBox.append(label);
}

document.getElementById("add").addEventListener("click", () => {
  addRow().querySelector(".url").focus();
});

// Reads and validates the instance rows. Returns null if any URL is invalid.
function readInstances() {
  const instances = [];
  const newTokens = {};
  let defaultInstanceId = null;
  let firstInvalid = null;

  for (const row of list.children) {
    const nameInput = row.querySelector(".name");
    const urlInput = row.querySelector(".url");
    const token = row.querySelector(".token").value.trim();
    urlInput.classList.remove("invalid");
    // Skip completely empty rows.
    if (!urlInput.value.trim() && !nameInput.value.trim() && !token) continue;
    const url = normalizeInstanceUrl(urlInput.value);
    if (!url) {
      urlInput.classList.add("invalid");
      firstInvalid ??= urlInput;
      continue;
    }
    urlInput.value = url;
    const name = nameInput.value.trim() || hostOf(url);
    nameInput.value = name;
    instances.push({ id: row.dataset.id, name, url });
    if (token) newTokens[row.dataset.id] = token;
    if (row.querySelector("input[type=radio]").checked) defaultInstanceId = row.dataset.id;
  }
  return { instances, tokens: newTokens, defaultInstanceId, firstInvalid };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { instances, tokens: newTokens, defaultInstanceId, firstInvalid } = readInstances();

  if (firstInvalid) {
    showStatus("Please enter a valid http(s) URL for each instance.", "error");
    firstInvalid.focus();
    return;
  }
  if (!instances.length) {
    showStatus("Add at least one NetBox instance.", "error");
    list.querySelector(".url").focus();
    return;
  }

  // Ask for host access first: Chrome only allows it in direct response to
  // the click.
  let apiEnabled = apiInput.checked;
  let hoverPreview = previewInput.checked;
  let warning = "";
  if (apiEnabled) {
    const origins = instances.map((i) => originPattern(i.url));
    // Access to all sites is only kept for the preview. Once granted it stays
    // until the API features are turned off, since dropping it could also
    // drop access to the instances.
    if (hoverPreview) origins.push(...ALL_SITES);
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins });
    } catch (error) {
      warning = error.message;
    }
    if (!granted) {
      apiEnabled = hoverPreview = false;
      apiInput.checked = previewInput.checked = false;
      updateApiDependents();
      warning = "Access was not granted, so the NetBox API features were turned off.";
    }
  } else {
    // Give back host access that is no longer needed.
    try {
      const { origins = [] } = await chrome.permissions.getAll();
      if (origins.length) await chrome.permissions.remove({ origins });
    } catch (error) {
      console.warn("Could not remove host access:", error);
    }
  }

  await chrome.storage.local.set({ tokens: newTokens });
  await chrome.storage.sync.set({
    instances,
    defaultInstanceId: defaultInstanceId ?? instances[0].id,
    smartDetect: smartInput.checked,
    openInBackground: bgInput.checked,
    apiEnabled,
    jumpToSingleMatch: jumpInput.checked,
    hoverPreview,
    menuTypes: [...typesBox.querySelectorAll("input:checked")].map((box) => box.value),
  });
  if (warning) showStatus(`Saved. ${warning}`, "error");
  else showStatus("Saved.", "ok");
});
