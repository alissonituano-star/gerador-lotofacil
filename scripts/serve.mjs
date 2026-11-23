import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { update } from "./update-results.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = Number(portArg?.split("=")[1] || process.env.PORT || 8000);
const HOST = hostArg?.split("=")[1] || process.env.HOST || "127.0.0.1";
const UPDATE_INTERVAL = 15 * 60_000;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(ROOT, safePath === "/" ? "index.html" : safePath));
  return filePath.startsWith(ROOT) ? filePath : null;
}

function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

async function refreshResults() {
  try {
    const payload = await update();
    console.log(`Resultados conferidos até o concurso ${payload.latest_contest}.`);
  } catch (error) {
    console.warn(`Não consegui atualizar os resultados: ${error.message} A base salva continua disponível.`);
  }
}

createServer(async (request, response) => {
  if (request.url === "/api/update" && request.method === "POST") {
    try {
      const payload = await update();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ok: true,
        message: `Base atualizada: ${payload.oldest_contest} a ${payload.latest_contest}.`,
        updated_at: payload.updated_at,
        total_contests: payload.total_contests,
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: error.message }));
    }
    return;
  }

  const filePath = resolvePath(request.url || "/");
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Arquivo nao encontrado");
    return;
  }

  const info = await stat(filePath);
  const finalPath = info.isDirectory() ? join(filePath, "index.html") : filePath;
  const headers = { "content-type": types[extname(finalPath)] || "application/octet-stream" };
  if (finalPath === join(ROOT, "data", "lotofacil.json")) {
    headers["cache-control"] = "no-cache";
    headers.etag = `W/"${info.size}-${info.mtimeMs}"`;
    if (request.headers["if-none-match"] === headers.etag) {
      response.writeHead(304, headers).end();
      return;
    }
  }
  response.writeHead(200, headers);
  createReadStream(finalPath).pipe(response);
}).listen(PORT, HOST, () => {
  console.log(`Servidor local: http://127.0.0.1:${PORT}`);
  if (HOST === "0.0.0.0") {
    localAddresses().forEach((address) => {
      console.log(`Celular na mesma rede: http://${address}:${PORT}`);
    });
  }
  void refreshResults();
  setInterval(refreshResults, UPDATE_INTERVAL).unref();
});
