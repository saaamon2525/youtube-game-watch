import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR, paths, readJson, writeJson } from "../lib/store.mjs";

const distDir = path.join(ROOT_DIR, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "data"), { recursive: true });
await mkdir(path.join(distDir, "config"), { recursive: true });

await cp(path.join(ROOT_DIR, "site"), distDir, { recursive: true });
await cp(paths.channels, path.join(distDir, "config", "channels.json"));

const videos = await readJson(paths.videos, []);
await writeJson(path.join(distDir, "data", "videos.json"), videos);
await writeFile(path.join(distDir, ".nojekyll"), "", "utf8");
