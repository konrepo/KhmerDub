const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");
const { normalizePoster, extractVideoLinks, extractMaxEpFromTitle } = require("../utils/helpers");
const { URL_TO_POSTID, POST_INFO, BLOG_IDS } = require("../utils/cache");

/* =========================
   GET POST ID
========================= */
async function getPostId(url) {
  if (URL_TO_POSTID.has(url)) return URL_TO_POSTID.get(url);

  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);

  const postId = $("div#player").attr("data-post-id") || null;

  // Extract max EP from page title
  const pageTitle = $("title").text();
  const maxEpMatch = pageTitle.match(/\[EP\s*(\d+)\]/i);
  const maxEp = maxEpMatch ? parseInt(maxEpMatch[1], 10) : null;

  if (postId) {
    URL_TO_POSTID.set(url, postId);

    if (maxEp) {
      POST_INFO.set(postId, {
        ...(POST_INFO.get(postId) || {}),
        maxEp,
      });
    }
  }

  return postId;
}

/* =========================
   BLOGGER FETCH
========================= */
async function fetchFromBlog(blogId, postId) {
  const feedUrl = `https://www.blogger.com/feeds/${blogId}/posts/default/${postId}?alt=json`;

  try {
    const { data } = await axiosClient.get(feedUrl);

    const title = data.entry.title.$t;
    const content = data.entry.content?.$t || "";
    const $content = cheerio.load(content);

    let thumbnail =
      $content('meta[property="og:image"]').attr("content") ||
      $content('meta[name="twitter:image"]').attr("content") ||
      $content("img").first().attr("src") ||
      data.entry.media$thumbnail?.url ||
      "";

    thumbnail = normalizePoster(thumbnail);

    const urls = extractVideoLinks(content);
    if (!urls.length) return null;

    return { title, thumbnail, urls };
  } catch {
    return null;
  }
}

/* =========================
   STREAM DETAIL
========================= */
async function getStreamDetail(postId) {
  const cached = POST_INFO.get(postId);
  if (cached?.detail) return cached.detail;

  for (const blogId of Object.values(BLOG_IDS)) {
    const detail = await fetchFromBlog(blogId, postId);
    if (detail) {
      POST_INFO.set(postId, { ...(POST_INFO.get(postId) || {}), detail });
      return detail;
    }
  }

  return null;
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const postId = await getPostId(seriesUrl);

  if (!postId) {
    return [];
  }

  const detail = await getStreamDetail(postId);

  if (!detail) {
    return [];
  }

  const maxEp = POST_INFO.get(postId)?.maxEp || null;

  const seen = new Set();
  let urls = [];

  for (const u of detail.urls) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
    title: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: detail.thumbnail,
    released: new Date().toISOString(),
  }));
}

/* =========================
   PLAYER RESOLVE
========================= */
async function resolvePlayerUrl(playerUrl) {
  try {
    const { data } = await axiosClient.get(playerUrl);

    const html = data
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const match = html.match(
      /https?:\/\/phumikhmer\.vip\/player\.php\?stream=[^"'<> ]+/i
    );

    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  const postId = await getPostId(seriesUrl);
  if (!postId) return null;

  const detail = await getStreamDetail(postId);
  if (!detail) return null;

  let url = detail.urls[episode - 1];
  if (!url) return null;

  if (url.includes("player.php")) {
    const resolved = await resolvePlayerUrl(url);
    if (!resolved) return null;
    url = resolved;
  }

  return {
    url,
    name: "KhmerDub",
    title: `Episode ${episode}`,
    type: url.includes(".m3u8") ? "hls" : undefined,
    behaviorHints: { group: "khmerdub" },
  };
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
  const { data } = await axiosClient.get(url);
  
  const $ = cheerio.load(data);

  const articles = $(siteConfig.articleSelector).toArray();

  const results = await Promise.all(
    articles.map(async (el) => {
      const $el = $(el);
      const a = $el.find(siteConfig.titleSelector).first();

      const title = a.text().trim();
      const link = a.attr("href");
      if (!title || !link) return null;

      let poster = "";
      const posterEl = $el.find(siteConfig.posterSelector).first();
      for (const attr of siteConfig.posterAttrs) {
        poster = posterEl.attr(attr) || poster;
        if (poster) break;
      }

      return {
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: title,
        poster: normalizePoster(poster),
      };
    })
  );

  return results.filter(Boolean);
  
  } catch {;
    return [];
  }  
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
};