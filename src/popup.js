import { ALL, OBJECT_TYPES } from "./netbox.js";
import { findInstance, getSettings, searchNetBox } from "./settings.js";

const form = document.getElementById("form");
const query = document.getElementById("query");
const instanceSelect = document.getElementById("instance");
const typeSelect = document.getElementById("type");
const hint = document.getElementById("hint");

const settings = await getSettings();
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

function updateHint() {
  const instance = findInstance(settings, instanceSelect.value);
  hint.textContent = instance ? instance.url : "No instance configured";
  hint.title = hint.textContent;
}
updateHint();
instanceSelect.addEventListener("change", updateHint);

document.getElementById("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!query.value.trim() && settings.instances.length) return;
  await chrome.storage.local.set({ popupInstanceId: instanceSelect.value, popupType: typeSelect.value });
  await searchNetBox(query.value, { instanceId: instanceSelect.value, type: typeSelect.value });
  window.close();
});
