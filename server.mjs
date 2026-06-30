import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectYoutubeVideos } from "./lib/youtube.mjs";
import { publicSettings, readJson, readSettings, saveSettings, paths, writeJson } from "./lib/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, "site");
const PORT = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(SITE_DIR, safePath);
  if (!filePath.startsWith(SITE_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/settings" && request.method === "GET") {
      sendJson(response, 200, publicSettings(await readSettings()));
      return;
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, publicSettings(await saveSettings(body)));
      return;
    }

    if (url.pathname === "/api/channels" && request.method === "GET") {
      sendJson(response, 200, await readJson(paths.channels, []));
      return;
    }

    if (url.pathname === "/api/videos" && request.method === "GET") {
      sendJson(response, 200, await readJson(paths.videos, []));
      return;
    }

    if (url.pathname === "/api/bookmarks" && request.method === "GET") {
      sendJson(response, 200, await readJson(paths.bookmarks, []));
      return;
    }

    if (url.pathname === "/api/bookmarks" && request.method === "POST") {
      const body = await readBody(request);
      const bookmarks = await readJson(paths.bookmarks, []);
      const now = new Date().toISOString();
      const sourceVideoIds = Array.isArray(body.sourceVideoIds) ? body.sourceVideoIds.filter(Boolean) : [];
      const key = String(body.key || `${body.gameName || ""}\n${body.url || ""}`);
      const existing = bookmarks.find((item) => item.key === key);
      if (existing) {
        existing.gameName = body.gameName || existing.gameName;
        existing.url = body.url ?? existing.url;
        existing.host = body.host ?? existing.host;
        existing.sourceVideoIds = [...new Set([...(existing.sourceVideoIds || []), ...sourceVideoIds])];
        existing.updatedAt = now;
      } else {
        bookmarks.unshift({
          key,
          gameName: body.gameName || "未分類",
          url: body.url || "",
          host: body.host || "",
          sourceVideoIds,
          note: "",
          createdAt: now,
          updatedAt: now
        });
      }
      await writeJson(paths.bookmarks, bookmarks);
      sendJson(response, 200, bookmarks);
      return;
    }

    if (url.pathname === "/api/bookmarks" && request.method === "DELETE") {
      await writeJson(paths.bookmarks, []);
      sendJson(response, 200, []);
      return;
    }

    if (url.pathname.startsWith("/api/bookmarks/") && request.method === "DELETE") {
      const key = decodeURIComponent(url.pathname.replace("/api/bookmarks/", ""));
      const bookmarks = await readJson(paths.bookmarks, []);
      const next = bookmarks.filter((item) => item.key !== key);
      await writeJson(paths.bookmarks, next);
      sendJson(response, 200, next);
      return;
    }

    if (url.pathname === "/api/log" && request.method === "GET") {
      sendJson(response, 200, await readJson(paths.log, []));
      return;
    }

    if (url.pathname === "/api/collect" && request.method === "POST") {
      const result = await collectYoutubeVideos();
      sendJson(response, 200, result.report);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`YouTube Game Watch: http://localhost:${PORT}`);
});
