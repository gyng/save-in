const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// WebExtensions do not expose the browser's public-suffix service. This compact
// ICANN subset covers the registry-operated suffixes where taking two labels
// would otherwise return a misleading value such as "co.uk" or "com.au".
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.in",
  "ac.jp",
  "ac.nz",
  "ac.uk",
  "asn.au",
  "co.in",
  "co.jp",
  "co.nz",
  "co.uk",
  "com.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sg",
  "com.tr",
  "edu.au",
  "edu.cn",
  "edu.in",
  "edu.mx",
  "edu.sg",
  "firm.in",
  "gen.in",
  "go.jp",
  "gob.mx",
  "gov.au",
  "gov.br",
  "gov.cn",
  "gov.in",
  "gov.sg",
  "gov.uk",
  "govt.nz",
  "id.au",
  "ind.in",
  "ltd.uk",
  "me.uk",
  "mil.in",
  "ne.jp",
  "net.au",
  "net.br",
  "net.cn",
  "net.in",
  "net.mx",
  "net.nz",
  "net.sg",
  "net.tr",
  "net.uk",
  "nhs.uk",
  "or.jp",
  "org.au",
  "org.br",
  "org.cn",
  "org.in",
  "org.mx",
  "org.nz",
  "org.sg",
  "org.tr",
  "org.uk",
  "plc.uk",
  "res.in",
  "sch.uk",
]);

export function toRootDomain(hostname: string): string;
export function toRootDomain(hostname: undefined): undefined;
export function toRootDomain(hostname: string | undefined): string | undefined {
  if (!hostname || IPV4_ADDRESS.test(hostname)) return hostname;
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const publicSuffix = labels.slice(-2).join(".").toLocaleLowerCase();
  return labels.slice(MULTI_LABEL_PUBLIC_SUFFIXES.has(publicSuffix) ? -3 : -2).join(".");
}
