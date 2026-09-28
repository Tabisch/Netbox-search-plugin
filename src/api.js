// NetBox REST API lookups. Pure fetch logic, no chrome.* APIs, so it can be
// unit tested in Node with a stubbed fetch.

import { ALL, OBJECT_TYPES, detectQuery, objectType } from "./netbox.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// NetBox 4.5+ "v2" tokens look like "nbt_<key>.<secret>" and use Bearer;
// older tokens use the "Token" scheme.
export function authHeader(token) {
  const value = (token || "").trim();
  if (!value) {
    return null;
  }
  return value.startsWith("nbt_") ? `Bearer ${value}` : `Token ${value}`;
}

// The API endpoints to query for a search. A detected IP/prefix/MAC/ASN in an
// "all" search uses its exact filter; otherwise each object list gets `q`.
export function apiRequests(query, { type = ALL, smart = false } = {}) {
  const q = query.trim();
  const listType = objectType(type);
  if (listType) {
    return [{ label: listType.label, path: listType.path, params: { q } }];
  }
  const detected = smart && detectQuery(q);
  if (detected) {
    return [{ label: detected.kind, path: detected.path, params: detected.params }];
  }
  return OBJECT_TYPES.map((t) => ({ label: t.label, path: t.path, params: { q } }));
}

async function apiGet(instanceUrl, token, path, params, signal) {
  const url = new URL(`${instanceUrl}/api${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const headers = { Accept: "application/json" };
  const auth = authHeader(token);
  if (auth) {
    headers.Authorization = auth;
  }
  let response;
  try {
    // Without a token, NetBox falls back to the browser's login session.
    response = await fetch(url, { headers, signal, credentials: "include" });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(`Can't reach ${url.host}.`, 0);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      token ? "The API token was rejected." : "Not authorized: log in to NetBox or add an API token in the options.",
      response.status,
    );
  }
  if (!response.ok) {
    throw new ApiError(`NetBox returned HTTP ${response.status}.`, response.status);
  }
  const type = response.headers.get("content-type") || "";
  // A login page (HTML) instead of JSON means the session isn't valid.
  if (!type.includes("json")) {
    throw new ApiError("Not authorized: log in to NetBox or add an API token in the options.", 403);
  }
  return response.json();
}

// The web UI link for an API object. `display_url` exists from NetBox 4.1;
// older versions only have the API `url`.
export function webUrl(object, instanceUrl) {
  if (object.display_url) {
    return object.display_url;
  }
  if (object.url) {
    return object.url.replace(/\/api\//, "/");
  }
  return instanceUrl;
}

function nameOf(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "object") {
    return String(value);
  }
  return value.label ?? value.display ?? value.name ?? null;
}

// A short, type-agnostic description, e.g. "Active · Site A · Tenant B".
export function describe(object) {
  const parts = [
    object.status,
    object.vid != null ? `VID ${object.vid}` : null,
    object.device,
    object.virtual_machine,
    object.assigned_object?.device,
    object.assigned_object,
    object.role,
    object.site,
    object.scope,
    object.cluster,
    object.provider,
    object.vrf,
    object.tenant,
  ]
    .map(nameOf)
    .filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

// Runs a search against the API. Returns { total, results, errors } where
// results are { typeLabel, display, detail, url } sorted by object type.
export async function searchApi(instanceUrl, token, query, { type, smart, limit = 5, signal } = {}) {
  const requests = apiRequests(query, { type, smart });
  const settled = await Promise.allSettled(
    requests.map((req) =>
      apiGet(instanceUrl, token, req.path, { ...req.params, limit }, signal).then((data) => ({ req, data })),
    ),
  );
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const results = [];
  const errors = [];
  let total = 0;
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      errors.push(outcome.reason);
      continue;
    }
    const { req, data } = outcome.value;
    total += data.count ?? data.results?.length ?? 0;
    for (const object of data.results ?? []) {
      results.push({
        typeLabel: req.label,
        display: object.display ?? object.name ?? String(object.id),
        detail: describe(object),
        url: webUrl(object, instanceUrl),
      });
    }
  }
  // Only fail if every request failed; partial results are still useful.
  if (errors.length === settled.length && errors.length) {
    throw errors[0];
  }
  return { total, results, errors };
}

// Returns NetBox's version string, or throws ApiError. /api/status/ can be
// public, so a device list request confirms that we can actually read data.
export async function checkConnection(instanceUrl, token, signal) {
  const status = await apiGet(instanceUrl, token, "/status/", {}, signal);
  await apiGet(instanceUrl, token, "/dcim/devices/", { limit: 1 }, signal);
  return status["netbox-version"] ?? "unknown version";
}
