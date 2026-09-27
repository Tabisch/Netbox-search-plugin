import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, detectQuery } from "../src/netbox.js";

const base = "https://nb.example.com/netbox";

test("global search by default", () => {
  assert.equal(buildSearchUrl(base, " core-sw01 "), `${base}/search/?q=core-sw01`);
});

test("object type search uses the list view", () => {
  assert.equal(buildSearchUrl(base, "rack 42", { type: "racks" }), `${base}/dcim/racks/?q=rack+42`);
  // Detection only applies to "all", not an explicit type.
  assert.equal(buildSearchUrl(base, "10.0.0.1", { type: "devices", smart: true }), `${base}/dcim/devices/?q=10.0.0.1`);
});

test("smart detection off keeps global search", () => {
  assert.equal(buildSearchUrl(base, "10.0.0.1"), `${base}/search/?q=10.0.0.1`);
});

const cases = [
  ["10.0.0.1", "/ipam/ip-addresses/", { address: "10.0.0.1" }],
  ["10.0.0.1/24", "/ipam/ip-addresses/", { address: "10.0.0.1/24" }],
  ["10.0.0.0/24", "/ipam/prefixes/", { prefix: "10.0.0.0/24" }],
  ["0.0.0.0/0", "/ipam/prefixes/", { prefix: "0.0.0.0/0" }],
  ["192.168.1.0/32", "/ipam/ip-addresses/", { address: "192.168.1.0/32" }],
  ["2001:db8::1", "/ipam/ip-addresses/", { address: "2001:db8::1" }],
  ["2001:DB8:0:0::/64", "/ipam/prefixes/", { prefix: "2001:db8::/64" }],
  ["2001:db8::1/64", "/ipam/ip-addresses/", { address: "2001:db8::1/64" }],
  ["00:1a:2b:3c:4d:5e", "/dcim/interfaces/", { mac_address: "00:1A:2B:3C:4D:5E" }],
  ["00-1A-2B-3C-4D-5E", "/dcim/interfaces/", { mac_address: "00:1A:2B:3C:4D:5E" }],
  ["001a.2b3c.4d5e", "/dcim/interfaces/", { mac_address: "00:1A:2B:3C:4D:5E" }],
  ["AS65001", "/ipam/asns/", { asn: "65001" }],
  ["as 4200000000", "/ipam/asns/", { asn: "4200000000" }],
];
for (const [input, path, params] of cases) {
  test(`detects ${input}`, () => {
    assert.deepEqual(detectQuery(input), { ...detectQuery(input), path, params });
  });
}

for (const input of ["core-sw01", "256.0.0.1", "10.0.0.1/33", "10.0.0", "00:1a:2b:3c:4d", "00:1a-2b:3c:4d:5e",
  "AS99999999999", "dead:beef", "1.2.3.4/24/1", "::g", "abc:def"]) {
  test(`does not detect ${input}`, () => {
    assert.equal(detectQuery(input), null);
  });
}

test("smart URL for a prefix", () => {
  assert.equal(buildSearchUrl(base, "10.0.0.0/8", { smart: true }), `${base}/ipam/prefixes/?prefix=10.0.0.0%2F8`);
});
