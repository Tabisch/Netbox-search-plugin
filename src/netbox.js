// NetBox URL building and query detection. No chrome.* APIs here, so this
// module can be unit tested in Node.

// Object lists that can be searched directly. Each list view accepts `q`.
export const OBJECT_TYPES = [
  { key: "devices", label: "Devices", path: "/dcim/devices/" },
  { key: "virtual-machines", label: "Virtual machines", path: "/virtualization/virtual-machines/" },
  { key: "interfaces", label: "Interfaces", path: "/dcim/interfaces/" },
  { key: "ip-addresses", label: "IP addresses", path: "/ipam/ip-addresses/" },
  { key: "prefixes", label: "Prefixes", path: "/ipam/prefixes/" },
  { key: "vlans", label: "VLANs", path: "/ipam/vlans/" },
  { key: "sites", label: "Sites", path: "/dcim/sites/" },
  { key: "racks", label: "Racks", path: "/dcim/racks/" },
  { key: "circuits", label: "Circuits", path: "/circuits/circuits/" },
  { key: "tenants", label: "Tenants", path: "/tenancy/tenants/" },
];

export const ALL = "all";

export function objectType(key) {
  return OBJECT_TYPES.find((type) => type.key === key);
}

function parseIPv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return { version: 4, bits: 32, value, text };
}

function parseIPv6(text) {
  if (!text.includes(":") || !/^[0-9a-f:.]+$/i.test(text)) return null;
  let host;
  try {
    // The URL parser validates and canonicalizes IPv6 literals for us.
    host = new URL(`http://[${text}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = host.includes("::") ? host.split("::") : [host, null];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array(8 - headGroups.length - tailGroups.length).fill("0");
  const groups = [...headGroups, ...fill, ...tailGroups];
  const value = groups.reduce((acc, group) => (acc << 16n) | BigInt(`0x${group}`), 0n);
  return { version: 6, bits: 128, value, text: host };
}

function parseIP(text) {
  return parseIPv4(text) || parseIPv6(text);
}

const MAC_PATTERNS = [
  /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i, // aa:bb:cc:dd:ee:ff / aa-bb-…
  /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i, // aabb.ccdd.eeff (Cisco)
];

function normalizeMac(text) {
  if (!MAC_PATTERNS.some((re) => re.test(text))) return null;
  const hex = text.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.match(/../g).join(":");
}

// Recognizes IPs, prefixes, MAC addresses and ASNs and maps them to the most
// specific NetBox list filter. Returns null for anything else.
export function detectQuery(input) {
  const text = input.trim();

  const asn = /^AS\s?(\d{1,10})$/i.exec(text);
  if (asn && Number(asn[1]) <= 4294967295) {
    return { kind: "ASN", path: "/ipam/asns/", params: { asn: asn[1] } };
  }

  const mac = normalizeMac(text);
  if (mac) {
    return { kind: "MAC address", path: "/dcim/interfaces/", params: { mac_address: mac } };
  }

  const [addrText, maskText, ...rest] = text.split("/");
  if (rest.length) return null;
  const ip = parseIP(addrText);
  if (!ip) return null;

  if (maskText === undefined) {
    return { kind: "IP address", path: "/ipam/ip-addresses/", params: { address: ip.text } };
  }
  if (!/^\d{1,3}$/.test(maskText) || Number(maskText) > ip.bits) return null;
  const mask = BigInt(maskText);
  const cidr = `${ip.text}/${maskText}`;
  const hostBits = (1n << (BigInt(ip.bits) - mask)) - 1n;
  const isHostRoute = mask === BigInt(ip.bits);
  if (!isHostRoute && (ip.value & hostBits) === 0n) {
    return { kind: "Prefix", path: "/ipam/prefixes/", params: { prefix: cidr } };
  }
  return { kind: "IP address", path: "/ipam/ip-addresses/", params: { address: cidr } };
}

function makeUrl(instanceUrl, path, params) {
  const url = new URL(`${instanceUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

// Builds the URL for searching `query` on `instanceUrl`.
// `type` is ALL for global search, or an OBJECT_TYPES key.
// With `smart`, a global search for an IP, prefix, MAC or ASN goes straight
// to the matching filtered list.
export function buildSearchUrl(instanceUrl, query, { type = ALL, smart = false } = {}) {
  const q = query.trim();
  const listType = objectType(type);
  if (listType) return makeUrl(instanceUrl, listType.path, { q });
  const detected = smart && detectQuery(q);
  if (detected) return makeUrl(instanceUrl, detected.path, detected.params);
  return makeUrl(instanceUrl, "/search/", { q });
}
