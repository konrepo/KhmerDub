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

async function getMaxEpFromSeriesPage(postId) {
  // Find the series URL from the catalog cache, if we have it
  // If not available, we can't fetch (because we only have postId).
  // So we return null and fall back to POST_INFO.
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
  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);
  return $("div#player").attr("data-post-id") || null;
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

async function getStreamDetail(postId) {
  for (const blogId of Object.values(BLOG_IDS)) {
    const detail = await fetchFromBlog(blogId, postId);
    if (detail) {
      return detail;
    }
  }
  return null;
}

/* =========================
   SCRAPE CATALOG VIP
========================= */
async function getItems(url) {
  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);

  const articles = $("article").toArray();

  const results = articles.map((el) => {
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

    // Optional: store maxEp temporarily using URL as key
    if (maxEp) {
      POST_INFO.set(link, { maxEp });
    }

    return {
      id: link,
      name: title,
      poster: normalizePoster(poster),
    };
  });

  return results.filter(Boolean);
}

async function getEpisodes(postId) {
  const detail = await getStreamDetail(postId);
  if (!detail) return [];

  // Dedupe while preserving order
  const seen = new Set();
  let urls = [];
  for (const u of detail.urls) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  // Cap to the episode count shown on the site (from catalog title like "EP 76")
  const maxEp = await getMaxEpFromSeriesPage(postId);
  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `vip:${postId}:${index + 1}`,
    title: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: normalizePoster(detail.thumbnail),
    released: new Date().toISOString(),
  }));
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
    const pageSize = 30;
    const skip = Number(extra?.skip || 0);
    const page = Math.floor(skip / pageSize) + 1;

    let url;

    // =========================
    // VIP
    // =========================
    if (id === "vip") {

      if (extra?.search) {
        url = `${BASE_URL}/?s=${encodeURIComponent(extra.search)}`;
      } else {
        url = page === 1
          ? BASE_URL
          : `${BASE_URL}/page/${page}/`;
      }

      const items = await getItems(url);

      return {
        metas: items.map(item => ({
          id: item.id,
          type: "series",
          name: item.name,
          poster: item.poster,
          posterShape: "poster"
        }))
      };
    }

    // =========================
    // IDRAMA
    // =========================
    if (id === "idrama") {

      if (extra?.search) {
        url = `https://www.idramahd.com/?s=${encodeURIComponent(extra.search)}`;
      } else {
        url = page === 1
          ? "https://www.idramahd.com/"
          : `https://www.idramahd.com/page/${page}/`;
      }

      const items = await getIdramaItems(url);

      return {
        metas: items.map(item => ({
          id: item.id,
          type: "series",
          name: item.name,
          poster: item.poster,
          posterShape: "poster"
        }))
      };
    }

    return { metas: [] };

  } catch (err) {
    return { metas: [] };
  }
});

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id }) => {
  try {
    // id is now the series URL
    const seriesUrl = id;

    // Get Blogger postId from the series page
    const postId = await getPostId(seriesUrl);
    if (!postId) return { meta: null };

    // Get episodes using Blogger postId
    const episodes = await getEpisodes(postId);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    return {
      meta: {
        id: seriesUrl, // keep URL as ID
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
    const parts = id.split(":");
    const postId = parts[1];
    const episode = parseInt(parts[2]);

    const detail = await getStreamDetail(postId);
    if (!detail) return { streams: [] };

    let url = detail.urls[episode - 1];
    if (!url) {
      return { streams: [] };
    }

    // If it's player.php, resolve real m3u8
    if (url.includes("player.php")) {
      const resolved = await resolvePlayerUrl(url);
      if (resolved) {
        url = resolved;
      } else {
        return { streams: [] };
      }
    }

    return {
      streams: [
        {
          url,
          name: "KhmerDub",
          title: `Episode ${episode}`,
          behaviorHints: {
            notWebReady: true,
            group: "khmerdub",
          },
        },
      ],
    };
  } catch {
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




