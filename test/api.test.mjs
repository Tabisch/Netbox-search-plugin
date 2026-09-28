import { test } from "node:test";
import assert from "node:assert/strict";
import { apiRequests, authHeader, checkConnection, describe, searchApi, webUrl } from "../src/api.js";

const base = "https://nb.example.com/netbox";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Replaces global fetch for one test; `handler(url, init)` returns a Response.
function stubFetch(t, handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return handler(new URL(url), init);
  };
  t.after(() => (globalThis.fetch = original));
  return calls;
}

test("auth header supports v1 and v2 tokens", () => {
  assert.equal(authHeader(""), null);
  assert.equal(authHeader(" 0123abcd "), "Token 0123abcd");
  assert.equal(authHeader("nbt_key.secret"), "Bearer nbt_key.secret");
});

test("api requests per search kind", () => {
  assert.deepEqual(apiRequests("sw01", { type: "devices" }), [{ label: "Devices", path: "/dcim/devices/", params: { q: "sw01" } }]);
  assert.deepEqual(apiRequests("10.0.0.0/8", { smart: true }), [
    { label: "Prefix", path: "/ipam/prefixes/", params: { prefix: "10.0.0.0/8" } },
  ]);
  const all = apiRequests("sw01");
  assert.ok(all.length > 5);
  assert.ok(all.every((r) => r.params.q === "sw01"));
});

test("web URL prefers display_url and falls back to the API url", () => {
  assert.equal(webUrl({ display_url: `${base}/dcim/devices/1/` }, base), `${base}/dcim/devices/1/`);
  assert.equal(webUrl({ url: `${base}/api/dcim/devices/1/` }, base), `${base}/dcim/devices/1/`);
});

test("describe summarizes common fields", () => {
  assert.equal(
    describe({ status: { value: "active", label: "Active" }, site: { display: "HQ" }, tenant: { display: "Ops" }, vid: 10 }),
    "Active · VID 10 · HQ · Ops",
  );
  assert.equal(
    describe({ assigned_object: { display: "eth0", device: { display: "sw01" } } }),
    "sw01 · eth0",
  );
});

test("searchApi sends auth, merges results and counts", async (t) => {
  const calls = stubFetch(t, (url) => {
    if (url.pathname.endsWith("/dcim/devices/")) {
      return json({ count: 7, results: [{ id: 1, display: "sw01", display_url: `${base}/dcim/devices/1/`, site: { display: "HQ" } }] });
    }
    return json({ count: 0, results: [] });
  });
  const { total, results, errors } = await searchApi(base, "abc", "sw01", { limit: 5 });
  assert.equal(total, 7);
  assert.deepEqual(results, [{ typeLabel: "Devices", display: "sw01", detail: "HQ", url: `${base}/dcim/devices/1/` }]);
  assert.deepEqual(errors, []);
  const deviceCall = calls.find((c) => c.url.pathname === "/netbox/api/dcim/devices/");
  assert.equal(deviceCall.url.searchParams.get("q"), "sw01");
  assert.equal(deviceCall.url.searchParams.get("limit"), "5");
  assert.equal(deviceCall.init.headers.Authorization, "Token abc");
});

test("searchApi keeps partial results when some requests fail", async (t) => {
  stubFetch(t, (url) =>
    url.pathname.includes("/circuits/") ? json({ detail: "nope" }, 500) : json({ count: 0, results: [] }),
  );
  const { total, errors } = await searchApi(base, "", "x");
  assert.equal(total, 0);
  assert.equal(errors.length, 1);
});

test("searchApi reports authorization problems", async (t) => {
  stubFetch(t, () => json({ detail: "Authentication credentials were not provided." }, 403));
  await assert.rejects(searchApi(base, "", "x", { type: "devices" }), /log in to NetBox or add an API token/);
});

test("an HTML login page counts as not authorized", async (t) => {
  stubFetch(t, () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(searchApi(base, "", "x", { type: "devices" }), /Not authorized/);
});

test("rejected token has its own message", async (t) => {
  stubFetch(t, () => json({ detail: "Invalid token" }, 403));
  await assert.rejects(checkConnection(base, "bad"), /token was rejected/);
});

test("checkConnection returns the version", async (t) => {
  stubFetch(t, (url) => json(url.pathname.endsWith("/status/") ? { "netbox-version": "4.3.1" } : { count: 0, results: [] }));
  assert.equal(await checkConnection(base, ""), "4.3.1");
});
