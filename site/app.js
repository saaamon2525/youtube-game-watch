const state = {
  videos: [],
  bookmarks: [],
  channels: [],
  settings: {},
  query: "",
  channel: "all",
  game: "all",
  sort: "publishedAt",
  unknownOnly: false,
  view: "card",
  page: "videos",
  selectedGameKey: ""
};

const $ = (selector) => document.querySelector(selector);
const grid = $("#videoGrid");
const status = $("#status");
const summary = $("#summary");
const LOCAL_BOOKMARKS_KEY = "youtube-game-watch-bookmarks";

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  if (!total) return "時間未取得";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function encodeState(value) {
  return encodeURIComponent(String(value ?? ""));
}

function readLocalBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_BOOKMARKS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocalBookmarks(bookmarks) {
  localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(bookmarks));
  return bookmarks;
}

async function staticApi(path, options = {}) {
  const method = options.method || "GET";
  if (path === "/api/settings") return { hasYoutubeApiKey: false, maxVideosPerChannel: 25, staticMode: true };
  if (path === "/api/channels") return fetch("./config/channels.json").then((response) => response.ok ? response.json() : []);
  if (path === "/api/videos") return fetch("./data/videos.json").then((response) => response.ok ? response.json() : []);
  if (path === "/api/bookmarks" && method === "GET") return readLocalBookmarks();
  if (path === "/api/bookmarks" && method === "POST") {
    const body = JSON.parse(options.body || "{}");
    const bookmarks = readLocalBookmarks();
    const now = new Date().toISOString();
    const existing = bookmarks.find((item) => item.key === body.key);
    if (existing) {
      existing.sourceVideoIds = [...new Set([...(existing.sourceVideoIds || []), ...(body.sourceVideoIds || [])])];
      existing.updatedAt = now;
    } else {
      bookmarks.unshift({ ...body, note: "", createdAt: now, updatedAt: now });
    }
    return writeLocalBookmarks(bookmarks);
  }
  if (path === "/api/bookmarks" && method === "DELETE") return writeLocalBookmarks([]);
  if (path.startsWith("/api/bookmarks/") && method === "DELETE") {
    const key = decodeURIComponent(path.replace("/api/bookmarks/", ""));
    return writeLocalBookmarks(readLocalBookmarks().filter((bookmark) => bookmark.key !== key));
  }
  if (path === "/api/collect") throw new Error("GitHub Pages版ではGitHub Actionsが自動収集します。");
  throw new Error("Static API fallback not found.");
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || response.statusText);
    return body;
  } catch (error) {
    return staticApi(path, options);
  }
}

function readUrlState() {
  const params = new URLSearchParams(location.search);
  state.page = ["games", "bookmarks"].includes(params.get("page")) ? params.get("page") : "videos";
  state.query = params.get("q") || "";
  state.channel = params.get("channel") || "all";
  state.game = params.get("game") || "all";
  state.sort = params.get("sort") || "publishedAt";
  state.unknownOnly = params.get("unknown") === "1";
  state.view = params.get("view") === "list" ? "list" : "card";
  state.selectedGameKey = params.get("gameKey") || "";
}

function writeUrlState(mode = "push") {
  const params = new URLSearchParams();
  if (state.page !== "videos") params.set("page", state.page);
  if (state.query) params.set("q", state.query);
  if (state.channel !== "all") params.set("channel", state.channel);
  if (state.game !== "all") params.set("game", state.game);
  if (state.sort !== "publishedAt") params.set("sort", state.sort);
  if (state.unknownOnly) params.set("unknown", "1");
  if (state.view !== "card") params.set("view", state.view);
  if (state.selectedGameKey) params.set("gameKey", state.selectedGameKey);

  const nextUrl = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
  if (nextUrl === `${location.pathname}${location.search}`) return;
  history[mode === "replace" ? "replaceState" : "pushState"]({}, "", nextUrl);
}

function syncControls() {
  $("#searchInput").value = state.query;
  $("#channelFilter").value = state.channel;
  $("#gameFilter").value = state.game;
  $("#sortSelect").value = state.sort;
  $("#unknownOnly").checked = state.unknownOnly;
}

function navigateState(changes, mode = "push") {
  Object.assign(state, changes);
  syncControls();
  renderCurrentPage();
  writeUrlState(mode);
}

function renderSummary() {
  const total = state.videos.length;
  const unknown = state.videos.filter((video) => video.game === "未分類").length;
  const latest = state.videos[0]?.publishedAt ? formatDate(state.videos[0].publishedAt) : "未収集";
  const top = [...state.videos].sort((a, b) => b.excitementScore - a.excitementScore)[0];
  summary.innerHTML = `
    <article><span>総動画数</span><strong>${formatNumber(total)}</strong></article>
    <article><span>未分類</span><strong>${formatNumber(unknown)}</strong></article>
    <article><span>最新投稿日</span><strong>${latest}</strong></article>
    <article><span>注目動画</span><strong>${top ? top.channelName : "未収集"}</strong></article>
  `;
}

function fillFilters() {
  const channelSelect = $("#channelFilter");
  const gameSelect = $("#gameFilter");
  const channels = [...new Set(state.videos.map((video) => video.channelName).filter(Boolean))].sort();
  const games = [...new Set(state.videos.map((video) => video.game).filter(Boolean))].sort();

  channelSelect.innerHTML = `<option value="all">全チャンネル</option>${channels.map((name) => `<option>${name}</option>`).join("")}`;
  gameSelect.innerHTML = `<option value="all">全ゲーム</option>${games.map((name) => `<option>${name}</option>`).join("")}`;
  syncControls();
}

function filteredVideos() {
  const query = state.query.trim().toLowerCase();
  return state.videos
    .filter((video) => state.channel === "all" || video.channelName === state.channel)
    .filter((video) => state.game === "all" || video.game === state.game)
    .filter((video) => {
      if (!state.selectedGameKey) return true;
      return videoGameKeys(video).includes(state.selectedGameKey);
    })
    .filter((video) => !state.unknownOnly || video.game === "未分類")
    .filter((video) => {
      if (!query) return true;
      return `${video.title} ${video.game} ${video.channelName}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (state.sort === "publishedAt") return String(b.publishedAt).localeCompare(String(a.publishedAt));
      return Number(b[state.sort] || 0) - Number(a[state.sort] || 0);
    });
}

function displayGameName(video, link = null) {
  return link?.gameName || (video.game !== "未分類" ? video.game : "") || (video.descriptionGameTitles || [])[0] || "未分類";
}

function gameKey(gameName, url = "") {
  return `${gameName}\n${url}`;
}

function videoGameKeys(video) {
  const links = video.gameLinks || [];
  if (links.length) return links.map((link) => gameKey(displayGameName(video, link), link.url));
  const name = displayGameName(video);
  return name === "未分類" ? [] : [gameKey(name, "")];
}

function channelButton(channelName) {
  return `<button class="linkButton" type="button" data-channel="${encodeState(channelName)}">${escapeHtml(channelName)}</button>`;
}

function bookmarkKeyForVideo(video) {
  const link = (video.gameLinks || [])[0] || null;
  return gameKey(displayGameName(video, link), link?.url || "");
}

function bookmarkPayloadFromVideo(video) {
  const link = (video.gameLinks || [])[0] || null;
  return {
    key: bookmarkKeyForVideo(video),
    gameName: displayGameName(video, link),
    url: link?.url || "",
    host: link?.host || "",
    sourceVideoIds: [video.videoId]
  };
}

function isBookmarked(key) {
  return state.bookmarks.some((bookmark) => bookmark.key === key);
}

function bookmarkButton(payload, compact = false) {
  const bookmarked = isBookmarked(payload.key);
  return `<button class="bookmarkButton ${bookmarked ? "active" : ""} ${compact ? "compact" : ""}" type="button" data-bookmark='${escapeHtml(JSON.stringify(payload))}'>${bookmarked ? "予定済み" : "予定に追加"}</button>`;
}

function aggregateGames() {
  const games = new Map();
  const sourceVideos = state.videos.filter((video) => state.channel === "all" || video.channelName === state.channel);

  for (const video of sourceVideos) {
    const links = video.gameLinks || [];
    if (links.length) {
      for (const link of links) {
        const gameName = displayGameName(video, link);
        const key = gameKey(gameName, link.url);
        const current = games.get(key) || {
          key,
          gameName,
          url: link.url,
          host: link.host,
          channels: new Set(),
          videos: [],
          latestPublishedAt: video.publishedAt,
          totalViews: 0,
          totalExcitement: 0
        };
        current.channels.add(video.channelName);
        current.videos.push(video);
        current.latestPublishedAt = String(video.publishedAt).localeCompare(String(current.latestPublishedAt)) > 0
          ? video.publishedAt
          : current.latestPublishedAt;
        current.totalViews += Number(video.viewCount || 0);
        current.totalExcitement += Number(video.excitementScore || 0);
        games.set(key, current);
      }
      continue;
    }

    const gameName = displayGameName(video);
    if (gameName === "未分類") continue;
    const key = gameKey(gameName, "");
    const current = games.get(key) || {
      key,
      gameName,
      url: "",
      host: "",
      channels: new Set(),
      videos: [],
      latestPublishedAt: video.publishedAt,
      totalViews: 0,
      totalExcitement: 0
    };
    current.channels.add(video.channelName);
    current.videos.push(video);
    current.latestPublishedAt = String(video.publishedAt).localeCompare(String(current.latestPublishedAt)) > 0
      ? video.publishedAt
      : current.latestPublishedAt;
    current.totalViews += Number(video.viewCount || 0);
    current.totalExcitement += Number(video.excitementScore || 0);
    games.set(key, current);
  }

  const query = state.query.trim().toLowerCase();
  return [...games.values()]
    .filter((game) => !query || `${game.gameName} ${game.url} ${[...game.channels].join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.latestPublishedAt).localeCompare(String(a.latestPublishedAt)));
}

function renderGameDetails(video) {
  const titles = video.descriptionGameTitles || [];
  const links = video.gameLinks || [];
  if (!titles.length && !links.length) return "";

  const titleHtml = titles.length
    ? `<div class="detailLine"><span>概要欄タイトル</span>${titles.map((title) => `<b>${escapeHtml(title)}</b>`).join("")}</div>`
    : "";
  const linkHtml = links.length
    ? `<div class="detailLine"><span>配布/ストア</span>${links.map((link) => `
        <b>${escapeHtml(displayGameName(video, link))}</b>
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.host || link.label || "link")}</a>
      `).join("")}</div>`
    : "";

  return `<div class="gameDetails">${titleHtml}${linkHtml}</div>`;
}

function renderCard(video) {
  return `
    <article class="videoCard">
      <a class="thumb" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(video.thumbnail)}" alt="">
      </a>
      <div class="cardBody">
        <div class="metaLine">
          <span>${channelButton(video.channelName)}</span>
          <span>${formatDateTime(video.publishedAt)}</span>
        </div>
        <h2><a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a></h2>
        <div class="game ${video.game === "未分類" ? "unknown" : ""}">${escapeHtml(video.game)}</div>
        ${bookmarkButton(bookmarkPayloadFromVideo(video), true)}
        ${renderGameDetails(video)}
        <div class="stats">
          <span>再生 ${formatNumber(video.viewCount)}</span>
          <span>長さ ${formatDuration(video.durationSeconds)}</span>
          <span>コメント ${formatNumber(video.commentCount)}</span>
          <span>熱量 ${formatNumber(video.excitementScore)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderListItem(video) {
  return `
    <article class="listItem">
      <a class="listThumb" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(video.thumbnail)}" alt="">
      </a>
      <div class="listMain">
        <div class="metaLine">
          <span>${channelButton(video.channelName)}</span>
          <span>${formatDateTime(video.publishedAt)}</span>
        </div>
        <h2><a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a></h2>
        <div class="listInfo">
          <span class="game ${video.game === "未分類" ? "unknown" : ""}">${escapeHtml(video.game)}</span>
          ${bookmarkButton(bookmarkPayloadFromVideo(video), true)}
          <span>長さ ${formatDuration(video.durationSeconds)}</span>
          <span>再生 ${formatNumber(video.viewCount)}</span>
          <span>コメント ${formatNumber(video.commentCount)}</span>
          <span>熱量 ${formatNumber(video.excitementScore)}</span>
        </div>
        ${renderGameDetails(video)}
      </div>
    </article>
  `;
}

function renderVideos() {
  const videos = filteredVideos();
  if (!videos.length) {
    grid.innerHTML = `<div class="empty">表示できる動画がありません。APIキーを保存して「収集」を押してください。</div>`;
    return;
  }

  grid.className = state.view === "list" ? "list" : "grid";
  $("#cardViewButton").classList.toggle("active", state.view === "card");
  $("#listViewButton").classList.toggle("active", state.view === "list");
  grid.innerHTML = videos.map((video) => state.view === "list" ? renderListItem(video) : renderCard(video)).join("");
}

function renderGames() {
  const games = aggregateGames();
  const panel = $("#gamesPanel");
  if (!games.length) {
    panel.innerHTML = `<div class="empty">ゲーム名とURLを表示できるデータがまだありません。もう一度「収集」を押すと概要欄解析が反映されます。</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="gameTable">
      <div class="gameRow head">
        <span>ゲーム名</span>
        <span>URL</span>
        <span>動画</span>
        <span>チャンネル</span>
        <span>最新投稿</span>
        <span>予定</span>
      </div>
      ${games.map((game) => `
        <div class="gameRow">
          <strong><button class="linkButton strong" type="button" data-game-key="${encodeState(gameKey(game.gameName, game.url))}">${escapeHtml(game.gameName)}</button></strong>
          <span>${game.url
            ? `<a href="${escapeHtml(game.url)}" target="_blank" rel="noreferrer">${escapeHtml(game.host || game.url)}</a>`
            : `<em>URL未検出</em>`}</span>
          <span><button class="linkButton" type="button" data-game-key="${encodeState(gameKey(game.gameName, game.url))}">${formatNumber(game.videos.length)}本</button></span>
          <span>${[...game.channels].map((channel) => channelButton(channel)).join(" / ")}</span>
          <span>${formatDateTime(game.latestPublishedAt)}</span>
          <span>${bookmarkButton({
            key: game.key,
            gameName: game.gameName,
            url: game.url,
            host: game.host,
            sourceVideoIds: game.videos.map((video) => video.videoId)
          }, true)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function videosByIds(ids) {
  const idSet = new Set(ids || []);
  return state.videos.filter((video) => idSet.has(video.videoId));
}

function renderBookmarks() {
  const panel = $("#bookmarksPanel");
  const query = state.query.trim().toLowerCase();
  const bookmarks = state.bookmarks
    .filter((bookmark) => !query || `${bookmark.gameName} ${bookmark.url} ${bookmark.host}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

  if (!bookmarks.length) {
    panel.innerHTML = `
      <div class="panelToolbar">
        <button class="dangerButton" type="button" data-clear-bookmarks>ブラウザ保存を削除</button>
      </div>
      <div class="empty">予定ゲームはまだありません。動画一覧かゲーム一覧から「予定に追加」を押してください。</div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="panelToolbar">
      <button class="dangerButton" type="button" data-clear-bookmarks>ブラウザ保存を削除</button>
    </div>
    <div class="gameTable bookmarkTable">
      <div class="gameRow bookmarkHead">
        <span>ゲーム名</span>
        <span>URL</span>
        <span>元動画</span>
        <span>追加日</span>
        <span>最終元動画</span>
        <span></span>
      </div>
      ${bookmarks.map((bookmark) => {
        const sourceVideos = videosByIds(bookmark.sourceVideoIds);
        return `
          <div class="gameRow bookmarkRow">
            <strong><button class="linkButton strong" type="button" data-game-key="${encodeState(bookmark.key)}">${escapeHtml(bookmark.gameName)}</button></strong>
            <span>${bookmark.url
              ? `<a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noreferrer">${escapeHtml(bookmark.host || bookmark.url)}</a>`
              : `<em>URL未検出</em>`}</span>
            <span>${sourceVideos.length
              ? sourceVideos.slice(0, 3).map((video) => `<a class="sourceVideoLink" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.channelName)}: ${escapeHtml(video.title)}</a>`).join("")
              : `<em>元動画なし</em>`}</span>
            <span>${formatDate(bookmark.createdAt)}</span>
            <span>${sourceVideos[0] ? `${formatDateTime(sourceVideos[0].publishedAt)} / ${formatDuration(sourceVideos[0].durationSeconds)}` : "-"}</span>
            <span><button class="dangerButton" type="button" data-remove-bookmark="${encodeState(bookmark.key)}">解除</button></span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCurrentPage() {
  const isGames = state.page === "games";
  const isBookmarks = state.page === "bookmarks";
  $("#videosPageButton").classList.toggle("active", !isGames && !isBookmarks);
  $("#gamesPageButton").classList.toggle("active", isGames);
  $("#bookmarksPageButton").classList.toggle("active", isBookmarks);
  $("#videoGrid").classList.toggle("hidden", isGames || isBookmarks);
  $("#gamesPanel").classList.toggle("hidden", !isGames);
  $("#bookmarksPanel").classList.toggle("hidden", !isBookmarks);
  $("#channelFilter").disabled = isGames || isBookmarks;
  $("#gameFilter").disabled = isGames || isBookmarks;
  $("#sortSelect").disabled = isGames || isBookmarks;
  $("#unknownOnly").disabled = isGames || isBookmarks;
  $("#cardViewButton").disabled = isGames || isBookmarks;
  $("#listViewButton").disabled = isGames || isBookmarks;
  if (isGames) renderGames();
  else if (isBookmarks) renderBookmarks();
  else renderVideos();
  const selectedLabel = state.selectedGameKey ? state.selectedGameKey.split("\n")[0] : "";
  if (selectedLabel && !isGames) {
    setStatus(`ゲームで絞り込み中: ${selectedLabel}`, "ok");
  }
}

async function refresh() {
  const [settings, channels, videos, bookmarks] = await Promise.all([
    api("/api/settings"),
    api("/api/channels"),
    api("/api/videos"),
    api("/api/bookmarks")
  ]);
  state.settings = settings;
  state.channels = channels;
  state.videos = videos;
  state.bookmarks = bookmarks;
  $("#maxVideosInput").value = settings.maxVideosPerChannel || 25;
  $("#apiKeyInput").placeholder = settings.hasYoutubeApiKey ? settings.youtubeApiKey : "AIza...";
  renderSummary();
  fillFilters();
  renderCurrentPage();
  setStatus(settings.hasYoutubeApiKey ? "準備完了" : "APIキーを保存してください", settings.hasYoutubeApiKey ? "ok" : "warn");
}

$("#collectButton").addEventListener("click", async () => {
  try {
    $("#collectButton").disabled = true;
    setStatus("収集中です。チャンネル数が多いので少し待ちます。");
    const report = await api("/api/collect", { method: "POST" });
    await refresh();
    setStatus(`収集完了: 新規 ${formatNumber(report.added)} 件 / 更新 ${formatNumber(report.updated)} 件`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    $("#collectButton").disabled = false;
  }
});

$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#saveSettingsButton").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        youtubeApiKey: $("#apiKeyInput").value,
        maxVideosPerChannel: $("#maxVideosInput").value
      })
    });
    $("#apiKeyInput").value = "";
    $("#settingsDialog").close();
    await refresh();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("#searchInput").addEventListener("input", (event) => {
  navigateState({ query: event.target.value }, "replace");
});
$("#channelFilter").addEventListener("change", (event) => {
  navigateState({ channel: event.target.value, selectedGameKey: "" });
});
$("#gameFilter").addEventListener("change", (event) => {
  navigateState({ game: event.target.value, selectedGameKey: "" });
});
$("#sortSelect").addEventListener("change", (event) => {
  navigateState({ sort: event.target.value });
});
$("#unknownOnly").addEventListener("change", (event) => {
  navigateState({ unknownOnly: event.target.checked });
});
$("#cardViewButton").addEventListener("click", () => {
  navigateState({ view: "card" });
});
$("#listViewButton").addEventListener("click", () => {
  navigateState({ view: "list" });
});
$("#videosPageButton").addEventListener("click", () => {
  navigateState({ page: "videos", selectedGameKey: "" });
  setStatus(state.settings.hasYoutubeApiKey ? "準備完了" : "APIキーを保存してください", state.settings.hasYoutubeApiKey ? "ok" : "warn");
});
$("#gamesPageButton").addEventListener("click", () => {
  navigateState({ page: "games" });
});
$("#bookmarksPageButton").addEventListener("click", () => {
  navigateState({ page: "bookmarks", selectedGameKey: "" });
});

document.addEventListener("click", (event) => {
  const bookmarkTarget = event.target.closest("[data-bookmark]");
  if (bookmarkTarget) {
    const payload = JSON.parse(bookmarkTarget.dataset.bookmark);
    api("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(payload)
    }).then((bookmarks) => {
      state.bookmarks = bookmarks;
      renderCurrentPage();
      setStatus(`予定に追加しました: ${payload.gameName}`, "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  const removeBookmarkTarget = event.target.closest("[data-remove-bookmark]");
  if (removeBookmarkTarget) {
    const key = decodeURIComponent(removeBookmarkTarget.dataset.removeBookmark);
    api(`/api/bookmarks/${encodeURIComponent(key)}`, {
      method: "DELETE"
    }).then((bookmarks) => {
      state.bookmarks = bookmarks;
      renderCurrentPage();
      setStatus("予定から解除しました", "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  const clearBookmarksTarget = event.target.closest("[data-clear-bookmarks]");
  if (clearBookmarksTarget) {
    api("/api/bookmarks", {
      method: "DELETE"
    }).then((bookmarks) => {
      state.bookmarks = bookmarks;
      renderCurrentPage();
      setStatus("ブラウザ保存の予定ゲームを削除しました", "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  const channelTarget = event.target.closest("[data-channel]");
  if (channelTarget) {
    const channel = decodeURIComponent(channelTarget.dataset.channel);
    navigateState({ channel, selectedGameKey: "" });
    setStatus(`チャンネルで絞り込み中: ${channel}`, "ok");
    return;
  }

  const gameTarget = event.target.closest("[data-game-key]");
  if (gameTarget) {
    navigateState({
      selectedGameKey: decodeURIComponent(gameTarget.dataset.gameKey),
      page: "videos",
      game: "all",
      query: ""
    });
  }
});

window.addEventListener("popstate", () => {
  readUrlState();
  syncControls();
  renderCurrentPage();
});

readUrlState();
refresh().catch((error) => setStatus(error.message, "error"));
