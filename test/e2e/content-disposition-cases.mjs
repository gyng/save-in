import http from "http";

import { listenLocal } from "./helpers.mjs";

export const CONTENT_DISPOSITION_CASES = [
  {
    id: "valid-extended",
    header:
      "attachment; filename=valid-extended-fallback.txt; filename*=UTF-8''valid-extended-%E2%82%AC.txt",
  },
  {
    id: "invalid-utf8",
    header:
      "attachment; filename=invalid-utf8-fallback.txt; filename*=UTF-8''invalid-utf8-%E2%82.txt",
  },
  {
    id: "quoted-extended",
    header:
      "attachment; filename=quoted-extended-fallback.txt; filename*=\"UTF-8''quoted-extended-%E2%82%AC.txt\"",
  },
  {
    id: "plain-percent-once",
    header: "attachment; filename=plain-percent-once%2520value.txt",
  },
  {
    id: "extended-percent-once",
    header: "attachment; filename*=UTF-8''extended-percent-once%2520value.txt",
  },
];

export const startContentDispositionServer = async () => {
  const server = http.createServer((req, res) => {
    const id = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
    const fixture = CONTENT_DISPOSITION_CASES.find((entry) => entry.id === id);
    if (!fixture) {
      res.writeHead(404);
      res.end();
      return;
    }

    const body = `Content-Disposition fixture: ${id}`;
    res.writeHead(200, {
      "Content-Disposition": fixture.header,
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "text/plain",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return { server, port: await listenLocal(server) };
};
