import { getSettings, normalizeInstanceUrl } from "./settings.js";

const form = document.getElementById("form");
const urlInput = document.getElementById("instanceUrl");
const bgInput = document.getElementById("openInBackground");
const status = document.getElementById("status");

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `status ${kind}`;
}

const settings = await getSettings();
urlInput.value = settings.instanceUrl;
bgInput.checked = settings.openInBackground;
if (!settings.instanceUrl) urlInput.focus();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const instanceUrl = normalizeInstanceUrl(urlInput.value);
  if (!instanceUrl) {
    showStatus("Please enter a valid http(s) URL.", "error");
    urlInput.focus();
    return;
  }
  urlInput.value = instanceUrl;
  await chrome.storage.sync.set({ instanceUrl, openInBackground: bgInput.checked });
  showStatus("Saved.", "ok");
});
