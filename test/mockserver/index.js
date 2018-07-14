const _ = require("koa-route");
const logger = require("koa-logger");
const serve = require("koa-static");
const Koa = require("koa");

const app = new Koa();

const routes = {
  cd: ctx => {
    const filename = "test/me/out";
    const mimetype = "text/plain";
    ctx.body = "downloadthis";
    ctx.set("Content-disposition", `attachment; filename=${filename}`);
    ctx.set("Content-type", mimetype);
    ctx.set("Cache-Control", "no-cache");
  },
  root: ctx => {
    ctx.body = `<html>
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
  }
};

app.use(serve("./test/mockserver/static"));
app.use(_.get("/", routes.root));
app.use(_.get("/cd", routes.cd));
app.use(_.head("/cd", routes.cd));
app.use(logger());

app.listen(3000);

console.log("http://localhost:3000"); // eslint-disable-line
