import { readJson, writeJson, paths } from "../lib/store.mjs";
import { enrichStoredVideo } from "../lib/youtube.mjs";

const videos = await readJson(paths.videos, []);
const aliases = await readJson(paths.gameAliases, []);
const nextVideos = videos.map((video) => enrichStoredVideo(video, aliases));

await writeJson(paths.videos, nextVideos);
console.log(`Reprocessed ${nextVideos.length} videos.`);
