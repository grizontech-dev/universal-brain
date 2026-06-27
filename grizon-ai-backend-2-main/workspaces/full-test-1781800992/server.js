const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type": "text/html"});
  res.end("<h1>Full Test OK!</h1>");
});
server.listen(9999, "0.0.0.0");