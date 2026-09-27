import { OBJECT_TYPES } from "./netbox.js";
import { getSettings, hostOf, newId, normalizeInstanceUrl } from "./settings.js";

const form = document.getElementById("form");
const list = document.getElementById("instances");
const rowTemplate = document.getElementById("instance-row");
const typesBox = document.getElementById("types");
const smartInput = document.getElementById("smartDetect");
const bgInput = document.getElementById("openInBackground");
const status = document.getElementById("status");

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `status ${kind}`;
}

function addRow(instance = { id: newId(), name: "", url: "" }, isDefault = false) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = instance.id;
  row.querySelector(".name").value = instance.name;
  row.querySelector(".url").value = instance.url;
  const radio = row.querySelector("input[type=radio]");
  radio.checked = isDefault || !list.children.length;
  row.querySelector(".remove").addEventListener("click", () => {
    const wasDefault = radio.checked;
    row.remove();
    if (wasDefault) {
      list.querySelector("input[type=radio]")?.click();
    }
    if (!list.children.length) {
      addRow();
    }
  });
  list.append(row);
  return row;
}

const settings = await getSettings();
for (const instance of settings.instances) {
  addRow(instance, instance.id === settings.defaultInstanceId);
}
if (!settings.instances.length) {
  addRow().querySelector(".url").focus();
}
smartInput.checked = settings.smartDetect;
bgInput.checked = settings.openInBackground;

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const instances = [];
  let defaultInstanceId = null;
  let firstInvalid = null;

  for (const row of list.children) {
    const nameInput = row.querySelector(".name");
    const urlInput = row.querySelector(".url");
    urlInput.classList.remove("invalid");
    // Skip completely empty rows.
    if (!urlInput.value.trim() && !nameInput.value.trim()) {
      continue;
    }
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
    if (row.querySelector("input[type=radio]").checked) {
      defaultInstanceId = row.dataset.id;
    }
  }

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

  await chrome.storage.sync.set({
    instances,
    defaultInstanceId: defaultInstanceId ?? instances[0].id,
    smartDetect: smartInput.checked,
    openInBackground: bgInput.checked,
    menuTypes: [...typesBox.querySelectorAll("input:checked")].map((box) => box.value),
  });
  showStatus("Saved.", "ok");
});
