const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
    id: "org.konrepo.khmerdub",
    version: "1.0.0",
    name: "KhmerDub",
    description: "Khmer Dubbed Series",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [
        {
            type: "series",
            id: "khmerave",
            name: "KhmerAve"
        }
    ]
};

const builder = new addonBuilder(manifest);

const axios = require("axios");
const cheerio = require("cheerio");


builder.defineCatalogHandler(async ({ id, extra }) => {
    if (id !== "khmerave") return { metas: [] };

    try {
        // Pagination (need to come back on this one)
        const skip = parseInt(extra?.skip || "0");
        const page = skip ? Math.floor(skip / 30) + 1 : 1;

        const url = page === 1
            ? "https://www.khmeravenue.com/album/"
            : `https://www.khmeravenue.com/album/page/${page}/`;

        const { data } = await axios.get(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);
        const metas = [];

        $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((i, el) => {
            const link = $(el).find("a").attr("href");

            let title = $(el).find("h3").text().trim();
            title = title
                .replace(/&#8217;/g, "'")
                .replace(/&amp;/g, "&")
                .replace(/\s+/g, " ")
                .trim();

            const style = $(el).find("div[style]").attr("style") || "";
            const match = style.match(/url\((.*?)\)/);
            const poster = match ? match[1] : "";

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

    } catch (err) {
        console.error("Catalog error:", err.message);
        return { metas: [] };
    }
});


builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series") return { meta: null };
	
	const realUrl = Buffer.from(id, "base64").toString("utf8");

    try {
        const { data } = await axios.get(realUrl, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);

        // Series title
        const pageTitle = $("h1").first().text().trim();

        // Poster
        let poster = "";
        const imgDiv = $(".album-content-image");
        if (imgDiv.length) {
            const style = imgDiv.attr("style") || "";
            const match = style.match(/url\((.*?)\)/);
            if (match) poster = match[1];
        }

        // Episode
        let episodes = [];

        $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]")
            .each((i, el) => {
                const link = $(el).attr("href");
                if (link) {
                    episodes.push(link);
                }
            });

        if (episodes.length) {
            episodes = [...new Set(episodes)];
            episodes = episodes.reverse();
        }

        const videos = episodes.map((link, index) => ({
            id: Buffer.from(link).toString("base64"),
            season: 1,
            episode: index + 1,
            title: `Episode ${String(index + 1).padStart(2, "0")}`,
            thumbnail: poster
        }));

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

  // Common patterns from Kodi (file:, iframe src, source src, playlist)
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


function htmlUnescape(s) {
  return (s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeOkUrl(url) {
  if (!url) return url;
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

// Resolver
async function resolveOkRuToDirect(iframeUrl, axios, ua) {
  try {
    const okUrl = normalizeOkUrl(iframeUrl);

    const okRes = await axios.get(okUrl, {
      headers: {
        "User-Agent": ua,
        "Referer": "https://ok.ru/",
      },
      timeout: 15000
    });

    let html = okRes.data;
    if (typeof html !== "string") {
      html = String(html);
    }

    // Decode HTML escaping
    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");

    // 1️⃣ Try real MP4 first
    const mp4Match = html.match(
      /"(https:\/\/vd[0-9\-\.]+okcdn\.ru\/\?[^"]+type=3[^"]*)"/
    );

    if (mp4Match && mp4Match[1]) {
      console.log("Extracted REAL MP4:", mp4Match[1]);
      return mp4Match[1];
    }

    // 2️⃣ Fallback to HLS
    const hlsMatch = html.match(
      /"ondemandHls"\s*:\s*"([^"]+)/
    );

    if (hlsMatch && hlsMatch[1]) {
      console.log("Extracted HLS:", hlsMatch[1]);
      return hlsMatch[1];
    }

    console.log("Could not extract stream");
    return null;

  } catch (err) {
    console.log("OK resolver error:", err.message);
    return null;
  }
}


builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };
  
  const realUrl = Buffer.from(id, "base64").toString("utf8");

  const UA =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

  console.log("STREAM REQUEST:", id);

  try {
    // Fetch episode page
    const epRes = await axios.get(realUrl, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://www.khmeravenue.com/"
      },
      timeout: 15000
    });

    const html = epRes.data;

    // Extract candidate link
    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
    console.log("Candidate:", candidate);

    if (!candidate) return { streams: [] };

    const cand = normalizeOkUrl(candidate);

    // OK.ru resolver
    if (cand.includes("ok.ru")) {
      const direct = await resolveOkRuToDirect(cand, axios, UA);
      console.log("Direct stream:", direct);

      if (!direct) return { streams: [] };

      return {
        streams: [
          {
            title: "KhmerDub",
            url: direct,
            behaviorHints: {
              proxyHeaders: {
                request: {
                  Referer: "https://ok.ru/",
                  "User-Agent": UA
                }
              }
            }
          }
        ]
      };
    }

    // Direct
    if (/\.(m3u8|mp4)(\?|$)/i.test(cand)) {
      return {
        streams: [
          {
            title: "KhmerDub",
            url: cand
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

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });