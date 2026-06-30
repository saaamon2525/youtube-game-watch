import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_DIR = path.join(ROOT_DIR, "config");
export const DATA_DIR = path.join(ROOT_DIR, "data");

export const paths = {
  channels: path.join(CONFIG_DIR, "channels.json"),
  gameAliases: path.join(CONFIG_DIR, "game_aliases.json"),
  settings: path.join(CONFIG_DIR, "settings.local.json"),
  settingsExample: path.join(CONFIG_DIR, "settings.example.json"),
  videos: path.join(DATA_DIR, "videos.json"),
  bookmarks: path.join(DATA_DIR, "bookmarks.json"),
  log: path.join(DATA_DIR, "collection-log.json")
};

export async function ensureDirs() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDirs();
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readSettings() {
  const defaults = await readJson(paths.settingsExample, {});
  const local = await readJson(paths.settings, {});
  return { ...defaults, ...local };
}

export async function saveSettings(settings) {
  const current = await readSettings();
  const incomingApiKey = String(settings.youtubeApiKey ?? "").trim();
  const shouldClearApiKey = settings.clearYoutubeApiKey === true;
  const next = {
    ...current,
    youtubeApiKey: shouldClearApiKey ? "" : incomingApiKey || current.youtubeApiKey || "",
    maxVideosPerChannel: Number(settings.maxVideosPerChannel ?? current.maxVideosPerChannel ?? 25),
    collectAfterIso: settings.collectAfterIso ?? current.collectAfterIso ?? null
  };
  await writeJson(paths.settings, next);
  return next;
}

export function publicSettings(settings) {
  const key = String(settings.youtubeApiKey ?? "");
  return {
    ...settings,
    youtubeApiKey: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : "",
    hasYoutubeApiKey: Boolean(key)
  };
}
