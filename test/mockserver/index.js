const fs = require("fs");
const http = require("http");
const path = require("path");

const staticRoot = path.join(__dirname, "static");
const port = Number(process.env.PORT || 3000);
const contentTypes = {
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".jpg": "image/jpeg",
  ".tar": "application/x-tar",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

const index = `<html>
  <a href="cd">Content-Disposition</a>
  <br>
  <a href="cd"><img src="origami.jpg" /></a>
  <hr>
  Example tests
  <br>
  <img src="cat.gif" /><br>
  <a href="ubuntu.v1.tar">ubuntu.v1.tar</a><br>
  <a href="debian.v2.gz">debian.v2.gz</a><br>
  <a href="debian.zip">debian.zip</a><br>
</html>`;

const send = (request, response, status, headers, body) => {
  response.writeHead(status, headers);
  response.end(request.method === "HEAD" ? undefined : body);
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  process.stdout.write(`${request.method} ${pathname}\n`);

  if (pathname === "/") {
    send(request, response, 200, { "Content-Type": "text/html; charset=utf-8" }, index);
    return;
  }
  if (pathname === "/cd") {
    send(
      request,
      response,
      200,
      {
        "Cache-Control": "no-cache",
        "Content-Disposition": "attachment; filename=test/me/out",
        "Content-Type": "text/plain",
      },
      "downloadthis",
    );
    return;
  }

  const name = path.basename(decodeURIComponent(pathname));
  const file = path.join(staticRoot, name);
  if (name !== pathname.slice(1) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(request, response, 404, { "Content-Type": "text/plain" }, "Not found");
    return;
  }
  send(
    request,
    response,
    200,
    { "Content-Type": contentTypes[path.extname(name)] || "application/octet-stream" },
    fs.readFileSync(file),
  );
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`http://localhost:${port}\n`);
});
