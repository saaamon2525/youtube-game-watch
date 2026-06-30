import { collectYoutubeVideos } from "../lib/youtube.mjs";

try {
  const result = await collectYoutubeVideos();
  console.log(JSON.stringify(result.report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
