import { readJson, readSettings, paths, writeJson } from "./store.mjs";

const API_BASE = "https://www.googleapis.com/youtube/v3";

function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

async function youtubeGet(endpoint, params, apiKey) {
  const url = `${API_BASE}/${endpoint}?${qs({ ...params, key: apiKey })}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw new Error(`YouTube API error: ${message}`);
  }
  return body;
}

function extractHandle(channel) {
  if (channel.handle) return channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`;
  const match = String(channel.url || "").match(/youtube\.com\/(@[^/?#]+)/i);
  return match?.[1] || null;
}

function extractCustomUrl(channel) {
  if (channel.customUrl) return channel.customUrl.replace(/^\/+/, "");
  const match = String(channel.url || "").match(/youtube\.com\/([^/?#]+)\/videos/i);
  return match?.[1]?.startsWith("@") ? null : match?.[1] || null;
}

async function resolveChannel(channel, apiKey) {
  if (channel.channelId) {
    const data = await youtubeGet("channels", {
      part: "snippet,contentDetails,statistics",
      id: channel.channelId,
      maxResults: 1
    }, apiKey);
    return data.items?.[0] || null;
  }

  const handle = extractHandle(channel);
  if (handle) {
    const data = await youtubeGet("channels", {
      part: "snippet,contentDetails,statistics",
      forHandle: handle,
      maxResults: 1
    }, apiKey);
    if (data.items?.[0]) return data.items[0];
  }

  const customUrl = extractCustomUrl(channel);
  if (customUrl) {
    const data = await youtubeGet("search", {
      part: "snippet",
      q: customUrl,
      type: "channel",
      maxResults: 1
    }, apiKey);
    const channelId = data.items?.[0]?.snippet?.channelId;
    if (channelId) {
      const resolved = await youtubeGet("channels", {
        part: "snippet,contentDetails,statistics",
        id: channelId,
        maxResults: 1
      }, apiKey);
      return resolved.items?.[0] || null;
    }
  }

  return null;
}

async function getPlaylistVideos(playlistId, apiKey, maxVideos) {
  const items = [];
  let pageToken = "";
  while (items.length < maxVideos) {
    const data = await youtubeGet("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: Math.min(50, maxVideos - items.length),
      pageToken
    }, apiKey);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

async function getVideoDetails(videoIds, apiKey) {
  const details = [];
  for (let index = 0; index < videoIds.length; index += 50) {
    const chunk = videoIds.slice(index, index + 50);
    const data = await youtubeGet("videos", {
      part: "snippet,statistics,contentDetails",
      id: chunk.join(","),
      maxResults: 50
    }, apiKey);
    details.push(...(data.items || []));
  }
  return details;
}

function inferGame(video, aliases) {
  const snippet = video.snippet || {};
  const haystack = [
    snippet.title,
    snippet.description,
    ...(snippet.tags || [])
  ].join(" ").toLowerCase();

  for (const entry of aliases) {
    for (const alias of entry.aliases || []) {
      if (haystack.includes(String(alias).toLowerCase())) {
        return { game: entry.game, confidence: "auto" };
      }
    }
  }

  return { game: "未分類", confidence: "unknown" };
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[・\-*【\[]+/, "")
    .replace(/[】\]]+$/, "")
    .trim();
}

function cleanGameName(value) {
  return cleanLine(value)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^(?:ゲームリンク|ゲームurl|url|link|リンク|配布先|配布|ダウンロード先|ダウンロード|プレイはこちら)\s*[：:⇒⇨→\-]*/i, "")
    .replace(/\s*[：:⇒⇨→\-]+$/, "")
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .trim();
}

function uniqueBy(items, keySelector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keySelector(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isGenericLinkLabel(value) {
  const label = cleanLine(value)
    .replace(/[：:⇒⇨→\-\s]+$/g, "")
    .toLowerCase();
  if (!label) return true;
  return [
    "url",
    "link",
    "steam",
    "itch.io",
    "配布",
    "配布先",
    "ダウンロード",
    "ダウンロード先",
    "ゲーム",
    "ゲームurl",
    "ゲームリンク",
    "リンク",
    "ゲームはこちら",
    "プレイはこちら",
    "game",
    "download"
  ].some((word) => label === word);
}

function isBadGameName(value) {
  const name = cleanGameName(value).toLowerCase();
  if (!name) return true;
  if (name.length > 80) return true;
  if (/^(?:第?\d+\s*[〜～~\-－]\s*\d+\s*章|第?\d+\s*章)$/i.test(name)) return true;
  if (/^(?:前編|中編|後編|完全版|単発|part\s*\d+|#\d+)$/i.test(name)) return true;
  if (/(?:ゲームリンク|ゲームリクエスト|関連動画|再生リスト|チャンネル登録|twitter|x ツイッター|instagram|タイムスタンプ|チャプター)/i.test(name)) return true;
  return false;
}

function extractTitleCandidatesFromVideoTitle(title) {
  const candidates = [];
  const text = String(title || "");
  const bracketPatterns = [
    /【([^】]{2,60})】/g,
    /『([^』]{2,60})』/g,
    /「([^」]{2,60})」/g,
    /\[([^\]]{2,60})\]/g
  ];

  for (const pattern of bracketPatterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanGameName(match[1]);
      if (!isBadGameName(candidate) && !/実況|切り抜き/i.test(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  if (!candidates.length) {
    const beforeLastBracket = text.replace(/[【『「\[].*?[】』」\]]\s*$/g, "");
    const tail = cleanGameName(beforeLastBracket.split(/[｜|]/).pop());
    if (!isBadGameName(tail) && tail.length <= 40) candidates.push(tail);
  }

  return candidates;
}

function classifyGameLink(url) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  const downloadHosts = [
    "store.steampowered.com",
    "itch.io",
    "gamejolt.com",
    "unityroom.com",
    "freem.ne.jp",
    "booth.pm",
    "novelgame.jp",
    "play.google.com",
    "apps.apple.com",
    "nintendo.com",
    "microsoft.com",
    "playstation.com",
    "epicgames.com"
  ];

  if (downloadHosts.some((known) => host === known || host.endsWith(`.${known}`))) {
    return host;
  }
  return null;
}

function extractDescriptionInfo(snippet) {
  const description = snippet.description || "";
  const lines = description.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const titleCandidates = extractTitleCandidatesFromVideoTitle(snippet.title);
  const gameLinks = [];
  const urlPattern = /https?:\/\/[^\s<>"'）)]+/gi;
  const titlePattern = /(?:ゲーム名|ゲームタイトル|タイトル|作品名|遊んだゲーム|プレイしたゲーム|game|title)\s*[:：]\s*(.+)$/i;
  let lastTitleCandidate = titleCandidates[0] || "";

  for (const line of lines) {
    const quotedTitle = line.match(/[『「]([^』」]{2,60})[』」]\s*実況/);
    if (quotedTitle?.[1]) {
      const title = cleanGameName(quotedTitle[1]);
      if (!isBadGameName(title)) {
        titleCandidates.push(title);
        lastTitleCandidate = title;
      }
    }

    const titleMatch = line.match(titlePattern);
    if (titleMatch?.[1]) {
      const title = cleanGameName(titleMatch[1].replace(urlPattern, ""));
      if (!isBadGameName(title)) {
        titleCandidates.push(title);
        lastTitleCandidate = title;
      }
    }

    const urls = line.match(urlPattern) || [];
    for (const url of urls) {
      const host = classifyGameLink(url);
      if (!host) continue;
      const label = cleanLine(line.replace(urlPattern, ""));
      const labelGameName = cleanGameName(label);
      const gameName = !isGenericLinkLabel(label) && !isBadGameName(labelGameName) ? labelGameName : lastTitleCandidate;
      gameLinks.push({
        url,
        host,
        label: label || host,
        gameName
      });
    }
  }

  return {
    descriptionGameTitles: uniqueBy(titleCandidates, (title) => title.toLowerCase()).slice(0, 5),
    gameLinks: uniqueBy(gameLinks, (link) => link.url).slice(0, 8)
  };
}

export function enrichStoredVideo(video, aliases = []) {
  const snippet = {
    title: video.title || "",
    description: video.description || "",
    tags: video.tags || [],
    publishedAt: video.publishedAt || "",
    channelId: video.channelId || "",
    channelTitle: video.youtubeChannelTitle || video.channelName || "",
    categoryId: video.categoryId || "",
    thumbnails: {}
  };
  const descriptionInfo = extractDescriptionInfo(snippet);
  const inferred = inferGame({ snippet }, aliases);
  const game =
    video.gameConfidence === "manual"
      ? video.game
      : inferred.game !== "未分類"
        ? inferred.game
        : descriptionInfo.descriptionGameTitles[0] || "未分類";
  const gameConfidence =
    video.gameConfidence === "manual"
      ? "manual"
      : inferred.game !== "未分類"
        ? inferred.confidence
        : descriptionInfo.descriptionGameTitles[0]
          ? "description"
          : "unknown";
  return {
    ...video,
    game,
    gameConfidence,
    descriptionGameTitles: descriptionInfo.descriptionGameTitles,
    gameLinks: descriptionInfo.gameLinks.map((link) => ({
      ...link,
      gameName: link.gameName || (game !== "未分類" ? game : "")
    }))
  };
}

function scoreVideo(stats, publishedAt) {
  const views = Number(stats?.viewCount || 0);
  const comments = Number(stats?.commentCount || 0);
  const likes = Number(stats?.likeCount || 0);
  const published = new Date(publishedAt).getTime();
  const ageDays = Math.max(1, Math.ceil((Date.now() - published) / 86400000));
  const excitement = Math.round((views / ageDays) + (comments * 2) + (likes * 0.05));
  return { views, comments, likes, ageDays, excitement };
}

function parseIsoDuration(value) {
  const match = String(value || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part || 0));
  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}

function normalizeVideo(video, channelInput, channelResolved, aliases) {
  const snippet = video.snippet || {};
  const duration = video.contentDetails?.duration || "";
  const stats = scoreVideo(video.statistics, snippet.publishedAt);
  const descriptionInfo = extractDescriptionInfo(snippet);
  const inferred = inferGame(video, aliases);
  const game =
    inferred.game !== "未分類"
      ? inferred.game
      : descriptionInfo.descriptionGameTitles[0] || "未分類";
  const gameConfidence =
    inferred.game !== "未分類"
      ? inferred.confidence
      : descriptionInfo.descriptionGameTitles[0]
        ? "description"
        : "unknown";
  const gameLinks = descriptionInfo.gameLinks.map((link) => ({
    ...link,
    gameName: link.gameName || (game !== "未分類" ? game : "")
  }));
  const thumbnail =
    snippet.thumbnails?.maxres?.url ||
    snippet.thumbnails?.standard?.url ||
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.medium?.url ||
    snippet.thumbnails?.default?.url ||
    "";

  return {
    videoId: video.id,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    title: snippet.title || "",
    description: snippet.description || "",
    publishedAt: snippet.publishedAt || "",
    duration,
    durationSeconds: parseIsoDuration(duration),
    channelId: snippet.channelId || channelResolved.id,
    channelName: channelInput.name || channelResolved.snippet?.title || snippet.channelTitle || "",
    youtubeChannelTitle: snippet.channelTitle || channelResolved.snippet?.title || "",
    thumbnail,
    game,
    gameConfidence,
    descriptionGameTitles: descriptionInfo.descriptionGameTitles,
    gameLinks,
    tags: snippet.tags || [],
    categoryId: snippet.categoryId || "",
    viewCount: stats.views,
    commentCount: stats.comments,
    likeCount: stats.likes,
    ageDays: stats.ageDays,
    excitementScore: stats.excitement,
    collectedAt: new Date().toISOString()
  };
}

export async function collectYoutubeVideos(options = {}) {
  const settings = await readSettings();
  const apiKey = options.apiKey || process.env.YOUTUBE_API_KEY || settings.youtubeApiKey;
  if (!apiKey) throw new Error("YouTube Data API key is not set.");

  const channels = await readJson(paths.channels, []);
  const aliases = await readJson(paths.gameAliases, []);
  const existing = await readJson(paths.videos, []);
  const existingById = new Map(existing.map((video) => [video.videoId, video]));
  const maxVideos = Number(options.maxVideosPerChannel || settings.maxVideosPerChannel || 25);
  const collectAfter = settings.collectAfterIso ? new Date(settings.collectAfterIso).getTime() : null;
  const report = [];

  for (const channel of channels.filter((item) => item.enabled !== false)) {
    const resolved = await resolveChannel(channel, apiKey);
    if (!resolved) {
      report.push({ channel: channel.name, status: "not_found", added: 0, updated: 0 });
      continue;
    }

    const uploadsId = resolved.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) {
      report.push({ channel: channel.name, status: "no_uploads_playlist", added: 0, updated: 0 });
      continue;
    }

    const playlistItems = await getPlaylistVideos(uploadsId, apiKey, maxVideos);
    const videoIds = playlistItems
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean);
    const details = await getVideoDetails(videoIds, apiKey);
    let added = 0;
    let updated = 0;

    for (const detail of details) {
      if (collectAfter && new Date(detail.snippet?.publishedAt || 0).getTime() < collectAfter) continue;
      const normalized = normalizeVideo(detail, channel, resolved, aliases);
      const previous = existingById.get(normalized.videoId);
      if (previous) {
        existingById.set(normalized.videoId, {
          ...previous,
          ...normalized,
          game: previous.gameConfidence === "manual" ? previous.game : normalized.game,
          gameConfidence: previous.gameConfidence === "manual" ? "manual" : normalized.gameConfidence
        });
        updated += 1;
      } else {
        existingById.set(normalized.videoId, normalized);
        added += 1;
      }
    }

    report.push({ channel: channel.name, status: "ok", added, updated });
  }

  const videos = [...existingById.values()].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  await writeJson(paths.videos, videos);
  const logEntry = {
    collectedAt: new Date().toISOString(),
    channels: report,
    totalVideos: videos.length,
    added: report.reduce((sum, item) => sum + item.added, 0),
    updated: report.reduce((sum, item) => sum + item.updated, 0)
  };
  const log = await readJson(paths.log, []);
  await writeJson(paths.log, [logEntry, ...log].slice(0, 100));
  return { videos, report: logEntry };
}
