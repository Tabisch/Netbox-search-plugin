import { getSettings, searchNetBox } from "./settings.js";

const form = document.getElementById("form");
const query = document.getElementById("query");
const instance = document.getElementById("instance");

const { instanceUrl } = await getSettings();
instance.textContent = instanceUrl || "No instance configured";
instance.title = instanceUrl;

document.getElementById("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!query.value.trim() && instanceUrl) return;
  await searchNetBox(query.value);
  window.close();
});
