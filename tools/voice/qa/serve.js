// Static server with SPA fallback. Usage: node serve.js <dir> <port>
const http = require("http"), fs = require("fs"), path = require("path");
const [dir, port] = [process.argv[2], +process.argv[3] || 3000];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log("serving", dir, "on", port));
