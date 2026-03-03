const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

// CONFIG
const UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

const BASE_URL =
  process.env.BASE_URL || "https://khmerdub.onrender.com";

// MANIFEST & BUILDER
const manifest = {
  id: "community.khmerdub.world",
  version: "3.0.2",
  name: "KhmerDub",
  description: "Stream Asian dramas dubbed in Khmer.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",
  developer: "TheDevilz",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "khmerave",
      name: "KhmerAve",
      genres: ["KhmerAve"],
      extra: [
        { name: "skip", isRequired: false },
        { name: "limit", isRequired: false },
        { name: "search", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "merlkon",
      name: "Merlkon",
      genres: ["Merlkon"],
      extra: [
        { name: "skip", isRequired: false },
        { name: "limit", isRequired: false },
        { name: "search", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// HELPERS 
function normalizeOkUrl(url) {
  if (!url) return url;
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

function tryExtractVideoCandidateFromKhmerAvenue(html) {
  // Base64.decode
  const b64 = html.match(/Base64\.decode\("(.+?)"\)/i);
  if (b64?.[1]) {
    try {
      const decoded = Buffer.from(b64[1], "base64").toString("utf8");
      const iframe = decoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframe?.[1]) return iframe[1];
    } catch {}
  }

  // Common patterns
  const patterns = [
    /['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/i,
    /<iframe[^>]*src=["']([^"']+)["']/i,
    /<source[^>]*src=["']([^"']+)["']/i,
    /playlist:\s*["']([^"']+)["']/i
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }

  return null;
}

// Extract m3u8 from OK iframe HTML
async function resolveOkRuToDirect(iframeUrl, ua) {
  try {
    const okUrl = normalizeOkUrl(iframeUrl);

    const okRes = await axios.get(okUrl, {
      headers: {
        "User-Agent": ua,
        "Referer": "https://ok.ru/"
      },
      timeout: 15000
    });

    let html = okRes.data;
    if (typeof html !== "string") html = String(html);

    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");

    const patterns = [
      /"ondemandHls"\s*:\s*"([^"]+)/,
      /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)/,
      /"hlsManifestUrl"\s*:\s*"([^"]+)/,
      /"metadataUrl"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/,
      /"(https:[^"]+\.m3u8[^"]*)"/
    ];

    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1].replace(/\\&/g, "&");
    }

    return null;
  } catch (err) {
    console.error("OK resolver error:", err.message);
    return null;
  }
}

// CATALOG HANDLER
builder.defineCatalogHandler(async (args) => {
  const { id, extra } = args;
  if (id !== "khmerave" && id !== "merlkon") return { metas: [] };

  try {
    if (extra?.search) {
      const keyword = encodeURIComponent(extra.search);
      let url;

      if (id === "khmerave") url = `https://www.khmeravenue.com/?s=${keyword}`;
      if (id === "merlkon") url = `https://www.khmerdrama.com/?s=${keyword}`;

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Referer:
            id === "merlkon"
              ? "https://www.khmerdrama.com/"
              : "https://www.khmeravenue.com/"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);
      let metas = [];

      $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((i, el) => {
        const link = $(el).find("a").attr("href");

        let title = $(el).find("h3").text().trim();
        title = title
          .replace(/&#8217;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();

        const style =
          $(el).find("div[style]").attr("style") ||
          $(el).find(".card-content-image").attr("style") ||
          "";

        const match = style.match(/url\((.*?)\)/);
        const poster = match ? match[1].replace(/['"]/g, "") : "";

        if (link && title) {
          metas.push({
            id: Buffer.from(link).toString("base64"),
            type: "series",
            name: title,
            poster,
            posterShape: "regular"
          });
        }
      });

      return { metas };
    }

    const skip = parseInt(extra?.skip || "0");
    const WEBSITE_PAGE_SIZE = 18;
    const PAGES_PER_BATCH = 3;
    const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

    let metas = [];

    for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
      let url;
      if (id === "khmerave") {
        url = p === 1 ? "https://www.khmeravenue.com/album/" : `https://www.khmeravenue.com/album/page/${p}/`;
      }
      if (id === "merlkon") {
        url = p === 1 ? "https://www.khmerdrama.com/album/" : `https://www.khmerdrama.com/album/page/${p}/`;
      }

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Referer:
            id === "merlkon"
              ? "https://www.khmerdrama.com/"
              : "https://www.khmeravenue.com/"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);

      $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((i, el) => {
        const link = $(el).find("a").attr("href");

        let title = $(el).find("h3").text().trim();
        title = title
          .replace(/&#8217;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();

        const style =
          $(el).find("div[style]").attr("style") ||
          $(el).find(".card-content-image").attr("style") ||
          "";

        const match = style.match(/url\((.*?)\)/);
        const poster = match ? match[1].replace(/['"]/g, "") : "";

        if (link && title) {
          metas.push({
            id: Buffer.from(link).toString("base64"),
            type: "series",
            name: title,
            poster,
            posterShape: "regular"
          });
        }
      });
    }

    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "series") return { meta: null };

  const realUrl = Buffer.from(id, "base64").toString("utf8");

  try {
    const { data } = await axios.get(realUrl, {
      headers: { "User-Agent": UA },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    const pageTitle = $("h1").first().text().trim();

    let poster = "";
    const imgDiv = $(".album-content-image");
    if (imgDiv.length) {
      const style = imgDiv.attr("style") || "";
      const match = style.match(/url\((.*?)\)/);
      if (match) poster = match[1];
    }

    let episodes = [];
    $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]").each((i, el) => {
      const link = $(el).attr("href");
      if (link) episodes.push(link);
    });

    if (episodes.length) {
      episodes = [...new Set(episodes)].reverse();
    }

    const videos = episodes.map((link, index) => {
      const isAlbum = link.includes("/album/");
      const episodeUrl = isAlbum ? link + "#ep1" : link;

      return {
        id: Buffer.from(episodeUrl).toString("base64"),
        season: 1,
        episode: index + 1,
        title: `Episode ${String(index + 1).padStart(2, "0")}`,
        thumbnail: poster
      };
    });

    return {
      meta: {
        id,
        type: "series",
        name: pageTitle || realUrl.split("/").filter(Boolean).pop().replace(/-/g, " "),
        poster,
        background: poster,
        videos
      }
    };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: null };
  }
});

/* ===============================
   STREAM HANDLER
   - If ok.ru iframe found → return /ok?iframe=...
   - If direct .m3u8/mp4 candidate → return /proxy?url=...
================================= */
builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };

  const realUrl = Buffer.from(id, "base64").toString("utf8").replace("#ep1", "");

  try {
    const epRes = await axios.get(realUrl, {
      headers: {
        "User-Agent": UA,
        Referer: realUrl.includes("khmerdrama.com")
          ? "https://www.khmerdrama.com/"
          : "https://www.khmeravenue.com/"
      },
      timeout: 15000
    });

    const html = epRes.data;
    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
    if (!candidate) return { streams: [] };

    const cand = normalizeOkUrl(candidate);

    // If OK iframe → let SAME server resolve it and proxy it
    if (cand.includes("ok.ru")) {
      const showName = realUrl
        .split("/")
        .filter(Boolean)
        .slice(-1)[0]
        .replace(/-\d+$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const epNumber = parseInt(realUrl.match(/-(\d+)\//)?.[1] || "1", 10);
      const formattedTitle = `${showName}  S01:E${String(epNumber).padStart(2, "0")}`;

      return {
        streams: [
          {
            title: formattedTitle,
            url: `${BASE_URL}/ok?iframe=${encodeURIComponent(cand)}`
          }
        ]
      };
    }

    // If direct .m3u8/.mp4, proxy it anyway for iOS
    if (/\.(m3u8|mp4)(\?|$)/i.test(cand)) {
      return {
        streams: [
          {
            title: "KhmerDub",
            url: `${BASE_URL}/proxy?url=${encodeURIComponent(cand)}`
          }
        ]
      };
    }

    return { streams: [] };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
});

/* ===============================
   EXPRESS APP: proxy endpoints
================================= */
const app = express();

// Health
app.get("/", (req, res) => res.send("KhmerDub (addon+proxy) running"));

// Preflight for iOS WebKit
app.options(["/proxy", "/ok"], (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.sendStatus(200);
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
}

/**
 * /ok?iframe=<ok.ru iframe url>
 * - resolves OK iframe into direct m3u8 on THIS server (same IP)
 * - then redirects to /proxy?url=<direct>
 */
app.get("/ok", async (req, res) => {
  setCors(res);

  const iframe = req.query.iframe;
  if (!iframe) return res.status(400).send("Missing iframe");

  const direct = await resolveOkRuToDirect(iframe, UA);
  if (!direct) return res.status(404).send("Could not resolve OK stream");

  // Redirect client to proxy endpoint (still same server)
  return res.redirect(`${BASE_URL}/proxy?url=${encodeURIComponent(direct)}`);
});

/**
 * /proxy?url=<m3u8 or segment url>
 * - streams media
 * - rewrites m3u8 lines to go back through /proxy
 */
app.get("/proxy", async (req, res) => {
  setCors(res);

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing url");

  try {
    const response = await axios({
      method: "GET",
      url: targetUrl,
      responseType: "stream",
      headers: {
        "User-Agent": UA,
        Referer: "https://ok.ru/"
      },
      timeout: 20000
    });

    const contentType = response.headers["content-type"] || "";

    // Playlist rewrite
    if (contentType.includes("application/vnd.apple.mpegurl") || targetUrl.includes(".m3u8")) {
      let playlist = "";

      response.data.on("data", (chunk) => {
        playlist += chunk.toString();
      });

      response.data.on("end", () => {
        try {
          const base = new URL(targetUrl);

          playlist = playlist.replace(/^(?!#)(.+)$/gm, (line) => {
            if (!line.trim()) return line;
            try {
              const absoluteUrl = new URL(line, base).href;
              return `${BASE_URL}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            } catch {
              return line;
            }
          });

          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.send(playlist);
        } catch (e) {
          console.error("Playlist rewrite error:", e.message);
          res.status(500).send("Playlist rewrite failed");
        }
      });

      return;
    }

    // Segments
    res.setHeader("Content-Type", contentType);
    response.data.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Proxy failed");
  }
});

/* ===============================
   MOUNT STREMIO ADDON ROUTES
================================= */
const addonInterface = builder.getInterface();

app.use((req, res) => {
  addonInterface(req, res);
});

/* ===============================
   START
================================= */
const port = process.env.PORT || 7000;
app.listen(port, () => console.log("Server listening on", port));