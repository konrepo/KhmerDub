const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const cheerio = require("cheerio");
const axios = require("axios");

/* =========================
   STREMIO MANIFEST
========================= */
const manifest = {
  id: "community.khmer.dubbed",
  version: "1.0.0",
  name: "KhmerDub",
  description: "Stream Asian dramas dubbed in Khmer | Dev: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "vip",
      name: "Phumikhmer",
      extraSupported: ["search", "skip"],
    },
    {
      type: "series",
      id: "idrama",
      name: "iDramaHD",
      extraSupported: ["search", "skip"],
    }    
  ],
};

const builder = new addonBuilder(manifest);

const BASE_URL = "https://phumikhmer.vip";

const URL_TO_POSTID = new Map(); // seriesUrl -> postId

const POST_INFO = new Map(); // postId -> { maxEp?: number }

const BLOG_IDS = {
  TVSABAY: "8016412028548971199",
  ONELEGEND: "596013908374331296",
  KOLAB: "7770980406614294729"
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const axiosClient = axios.create({
  headers: { "User-Agent": USER_AGENT },
  timeout: 15000,
});

function getMaxEpFromSeriesPage(postId) {
  return POST_INFO.get(postId)?.maxEp || null;
}

/* =========================
   UTIL
========================= */
function normalizePoster(url) {
  if (!url) return "";
  return url
    .replace(/\/s\d+\//, "/s0/")
    .replace(/=s\d+/, "=s0");
}

function extractVideoLinks(text) {
  const directRegex =
    /https?:\/\/[^\s"';<> ]+\.(?:m3u8|mp4)(?:\?[^\s"';<> ]+)?/gi;

  const okRegex =
    /https?:\/\/ok\.ru\/videoembed\/\d+/gi;

  const playerRegex =
    /https?:\/\/phumikhmer\.vip\/player\.php\?id=\d+/gi;

  const directMatches = text.match(directRegex) || [];
  const okMatches = text.match(okRegex) || [];
  const playerMatches = text.match(playerRegex) || [];

  return Array.from(new Set([
    ...directMatches,
    ...okMatches,
    ...playerMatches
  ]));
}

async function getPostId(url) {
  if (URL_TO_POSTID.has(url)) return URL_TO_POSTID.get(url);

  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);
  const postId = $("div#player").attr("data-post-id") || null;

  if (postId) URL_TO_POSTID.set(url, postId);
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
    const year =
      parseInt(data.entry.published.$t.slice(0, 4)) ||
      new Date().getFullYear();

    const content = data.entry.content?.$t || "";

    // Extract thumbnail from content
    let thumbnail = "";

    // Try og:image inside content
    const $content = cheerio.load(content);

    thumbnail =
      $content('meta[property="og:image"]').attr("content") ||
      $content('meta[name="twitter:image"]').attr("content") ||
      "";

    // Fallback to first image inside content
    if (!thumbnail) {
      thumbnail = $content("img").first().attr("src") || "";
    }

    // Fallback to Blogger thumbnail
    if (!thumbnail) {
      thumbnail = data.entry.media$thumbnail?.url || "";
    }

    // Clean & normalize once
    thumbnail = normalizePoster(thumbnail);

    const urls = extractVideoLinks(content);
    if (!urls.length) return null;

    return {
      title,
      thumbnail,
      year,
      urls,
    };
  } catch {
    return null;
  }
}

/* =========================
   BLOGGER DETAIL RESOLVER
========================= */
async function getStreamDetail(postId) {
  //  Check cache first
  const cached = POST_INFO.get(postId);
  if (cached?.detail) {
    return cached.detail;
  }

  // Fetch from blogs
  for (const blogId of Object.values(BLOG_IDS)) {
    const detail = await fetchFromBlog(blogId, postId);
    if (detail) {

      // Save to cache
      POST_INFO.set(postId, {
        ...(POST_INFO.get(postId) || {}),
        detail
      });

      return detail;
    }
  }

  return null;
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(postId, source) {
  const detail = await getStreamDetail(postId);
  if (!detail) return [];

  const seen = new Set();
  let urls = [];
  for (const u of detail.urls) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  const maxEp = getMaxEpFromSeriesPage(postId);
  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `${source}:${postId}:1:${index + 1}`, 
    title: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: detail.thumbnail,
    released: new Date().toISOString(),
  }));
}

/* =========================
   SCRAPE CATALOG VIP
========================= */
async function getItems(url) {
  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);

  const articles = $("article").toArray();

  const results = await Promise.all(
    articles.map(async (el) => {
      const $el = $(el);
      const a = $el.find("h2 a, h3 a").first();

      const title = a.text().trim();
      const link = a.attr("href");
      if (!title || !link) return null;

      const epMatch =
        title.match(/\bEP\.?\s*(\d+)\b/i) ||
        title.match(/\bEpisode\s*(\d+)\b/i) ||
        title.match(/\[EP\.?\s*(\d+)\]/i);

      const maxEp = epMatch ? parseInt(epMatch[1], 10) : null;

      const poster =
        $el.find("a.img-holder").attr("data-src") ||
        $el.find("a.img-holder").attr("data-bsrjs") ||
        "";

      // Resolve postId NOW
      const postId = await getPostId(link);
      if (!postId) return null;

      // Cache mapping
      URL_TO_POSTID.set(link, postId);

      // Store maxEp using postId (not link)
      if (maxEp) {
        POST_INFO.set(postId, {
          ...(POST_INFO.get(postId) || {}),
          maxEp,
        });
      }

      return {
        id: `vip:${postId}`,
        name: title,
        poster: normalizePoster(poster),
      };
    })
  );

  return results.filter(Boolean);
}

/* =========================
   SCRAPE CATALOG IDRAMA
========================= */
async function getIdramaItems(url) {
  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);

  const articles = $("article.hitmag-post").toArray();

  const results = articles.map((el) => {
    const $el = $(el);
    const a = $el.find("h3.entry-title a").first();
    if (!a.length) return null;

    const title = a.text().trim();
    const link = a.attr("href");

    const img = $el.find(".archive-thumb img").first();
    const poster =
      img.attr("data-src") ||
      img.attr("src") ||
      "";

    if (!title || !link) return null;

    return {
      id: link,
      name: title,
      poster: normalizePoster(poster),
    };
  });

  return results.filter(Boolean);
}

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const PAGE_SIZE = 30;
    const skip = Number(extra?.skip || 0);

    // Determine which WP page we need
    const wpPage = Math.floor(skip / PAGE_SIZE) + 1;

    let url;
    let items = [];

    if (id === "vip") {
      if (extra?.search) {
        url = `${BASE_URL}/?s=${encodeURIComponent(extra.search)}`;
      } else {
        url = wpPage === 1
          ? BASE_URL
          : `${BASE_URL}/page/${wpPage}/`;
      }

      items = await getItems(url);
    }

    else if (id === "idrama") {
      const IDRAMA_BASE = "https://www.idramahd.com";

      if (extra?.search) {
        url = `${IDRAMA_BASE}/?s=${encodeURIComponent(extra.search)}`;
      } else {
        url = wpPage === 1
          ? IDRAMA_BASE
          : `${IDRAMA_BASE}/page/${wpPage}/`;
      }

      items = await getIdramaItems(url);
    }

    // Now slice relative to skip
    const startIndex = skip % PAGE_SIZE;
    const metas = items
      .slice(startIndex, startIndex + PAGE_SIZE)
      .map(item => ({
        id: item.id,
        type: "series",
        name: item.name,
        poster: item.poster,
        posterShape: "poster"
      }));

    return { metas };

  } catch (err) {
    console.error("Catalog error:", err);
    return { metas: [] };
  }
});

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id }) => {
  try {
    // id is now like: "vip:123456789"
    const parts = id.split(":");
    const prefix = parts[0];
    const postId = parts[1];

    if (!postId) return { meta: null };

    // source is now determined by prefix
    const source = prefix;

    const episodes = await getEpisodes(postId, source);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    return {
      meta: {
        id: `vip:${postId}`,  // consistent prefix ID
        type: "series",
        name: first.title,
        poster: first.thumbnail,
        background: first.thumbnail,
        videos: episodes,
      },
    };
  } catch (err) {
    return { meta: null };
  }
});

/* =========================
   RESOLVER Kolab
========================= */
async function resolvePlayerUrl(playerUrl) {
  try {
    const { data } = await axiosClient.get(playerUrl);

    // Unescape slashes and ampersands
    let html = data
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    // Extract full proxied stream URL
    const match = html.match(
      /https?:\/\/phumikhmer\.vip\/player\.php\?stream=[^"'<> ]+/i
    );

    if (match) {
      return match[0];
    }

    return null;
  } catch (e) {
    return null;
  }
}

/* =========================
   STREAM
========================= */
builder.defineStreamHandler(async ({ id }) => {
  try {
    console.log("STREAM ID RECEIVED:", id);

    const parts = id.split(":");

    let postId, episode;

    if (parts.length === 3) {
      // vip:postId:episode   (Stremio desktop)
      postId = parts[1];
      episode = parseInt(parts[2], 10);
    } else if (parts.length === 4) {
      // vip:postId:season:episode   (Nuvio)
      postId = parts[1];
      episode = parseInt(parts[3], 10);
    } else {
      return { streams: [] };
    }

    if (isNaN(episode)) return { streams: [] };

    const detail = await getStreamDetail(postId);
    if (!detail) return { streams: [] };

    let url = detail.urls[episode - 1];
    if (!url) return { streams: [] };

    if (url.includes("player.php")) {
      const resolved = await resolvePlayerUrl(url);
      if (resolved) url = resolved;
      else return { streams: [] };
    }

    return {
      streams: [
        {
          url,
          name: "KhmerDub",
          title: `Episode ${episode}`,
          type: url.includes(".m3u8") ? "hls" : undefined,
          behaviorHints: {
            group: "khmerdub"
          }
        }
      ]
    };

  } catch (err) {
    return { streams: [] };
  }
});

/* =========================
   START SERVER
========================= */
serveHTTP(builder.getInterface(), {
  port: process.env.PORT || 7000,
});

console.log("Khmer VIP Addon running");




