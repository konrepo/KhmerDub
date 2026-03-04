const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
    id: "community.khmerdub.world",
    version: "3.0.1",
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

const axios = require("axios");
const cheerio = require("cheerio");


builder.defineCatalogHandler(async (args) => {

    const { id, extra } = args;
    if (id !== "khmerave" && id !== "merlkon") return { metas: [] };

    try {
		
		// Search
        if (extra?.search) {

            const keyword = encodeURIComponent(extra.search);
            let url;

            if (id === "khmerave") {
                url = `https://www.khmeravenue.com/?s=${keyword}`;
            }

            if (id === "merlkon") {
                url = `https://www.khmerdrama.com/?s=${keyword}`;
            }

            const { data } = await axios.get(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                    "Referer": id === "merlkon"
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
                    $(el).find(".card-content-image").attr("style") || "";

                const match = style.match(/url\((.*?)\)/);
                const poster = match
                    ? match[1].replace(/['"]/g, "")
                    : "";

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
        // End search

        const skip = parseInt(extra?.skip || "0");

        const WEBSITE_PAGE_SIZE = 18;
        const PAGES_PER_BATCH = 3; // 3 website pages = ~54 items

        const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let metas = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
			
			let url;
			
			if (id === "khmerave") {
				url = p === 1
                    ? "https://www.khmeravenue.com/album/"
                    : `https://www.khmeravenue.com/album/page/${p}/`;
			}		

			if (id === "merlkon") {
				url = p === 1
                    ? "https://www.khmerdrama.com/album/"
                    : `https://www.khmerdrama.com/album/page/${p}/`;
			}           

            const { data } = await axios.get(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
					"Referer": id === "merlkon"
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
					$(el).find(".card-content-image").attr("style") ||"";
				
                const match = style.match(/url\((.*?)\)/);
                const poster = match 
					? match[1].replace(/['"]/g, "") : "";

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


builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series") return { meta: null };
	
	const realUrl = Buffer.from(id, "base64").toString("utf8");

    try {
		
		const referer = realUrl.includes("khmerdrama.com")
        ? "https://www.khmerdrama.com/"
        : "https://www.khmeravenue.com/";
		
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
                if (!link) return;

                // Exclude random post_type video (bad Episode 1)
                if (link.includes("?post_type=videos")) return;

                let epNumber = 1;

                // Album page = Episode 1
                if (!link.includes("/album/")) {
                    const match = link.match(/-(\d+)/);
                    if (match) {
                        epNumber = parseInt(match[1], 10);
                    }
                }

                episodes.push({ link, epNumber });
            });

        if (episodes.length) {
            // Remove duplicates
            episodes = [...new Map(episodes.map(e => [e.link, e])).values()];

            // Sort by episode number
            episodes.sort((a, b) => a.epNumber - b.epNumber);
        }

        const videos = episodes.map((item) => {
            const isAlbum = item.link.includes("/album/");
            const episodeUrl = isAlbum ? item.link + "#ep1" : item.link;

            return {
                id: Buffer.from(episodeUrl).toString("base64"),
                season: 1,
                episode: item.epNumber,
                title: `Episode ${String(item.epNumber).padStart(2, "0")}`,
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
async function resolveOkRuSources(iframeUrl, axios, ua) {
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
    if (typeof html !== "string") html = String(html);

    // Unescape common OK.ru escaping
    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");

    const pickFirst = (patterns) => {
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) return m[1].replace(/\\&/g, "&");
      }
      return null;
    };

    // Prefer MP4 for web/iOS when possible
    const mp4 = pickFirst([
      /"ondemandMp4"\s*:\s*"([^"]+)/i,
      /"mp4Url"\s*:\s*"([^"]+)/i,
      /"(https:[^"]+\.mp4[^"]*)"/i
    ]);

    // HLS fallback (often what you currently get)
    const hls = pickFirst([
      /"ondemandHls"\s*:\s*"([^"]+)/i,
      /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)/i,
      /"hlsManifestUrl"\s*:\s*"([^"]+)/i,
      /"metadataUrl"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/i,
      /"(https:[^"]+\.m3u8[^"]*)"/i
    ]);

    return { mp4, hls, page: okUrl };
  } catch (err) {
    console.error("OK resolver error:", err.message);
    return { mp4: null, hls: null, page: normalizeOkUrl(iframeUrl) };
  }
}


// Helper functions for EP1
async function handleEpisodeOne(url, UA) {
  try {
    const epRes = await axios.get(url, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://www.khmeravenue.com/"
      },
      timeout: 15000
    });

    const html = epRes.data;
    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
    if (!candidate) return { streams: [] };

    const cand = normalizeOkUrl(candidate);
    const src = await resolveOkRuSources(cand, axios, UA);

    const streams = [];

    // Extract show name from URL
    const showName = url
      .split("/")
      .filter(Boolean)
      .slice(-1)[0]
      .replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());

    const formattedTitle = `${showName}  S01:E01`;

    // 1) Web-ready MP4 (best for iOS/Web)
    if (src.mp4 && /^https:\/\//i.test(src.mp4)) {
      streams.push({
        name: "KhmerDub (MP4)",
        description: formattedTitle,
        url: src.mp4
      });
    }

    // 2) HLS via proxy (works on desktop/android more often)
    if (src.hls) {
      streams.push({
        name: "KhmerDub (HLS)",
        description: formattedTitle,
        url: src.hls,
        behaviorHints: {
          notWebReady: true,
          proxyHeaders: {
            request: {
              Referer: "https://ok.ru/",
              "User-Agent": UA
            }
          }
        }
      });
    }

    // 3) External fallback for iOS (opens in browser)
    if (src.page) {
      streams.push({
        name: "Open in Browser",
        description: formattedTitle,
        externalUrl: src.page
      });
    }

    return { streams };
  } catch (err) {
    console.error("EP1 error:", err.message);
    return { streams: [] };
  }
}


builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };

  const decoded = Buffer.from(id, "base64").toString("utf8");
  const realUrl = decoded.replace("#ep1", "");

  const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  // Detect EP1 (album page)
  if (realUrl.includes("/album/")) {
    return await handleEpisodeOne(realUrl, UA);
  }

  try {
    const epRes = await axios.get(realUrl, {
      headers: {
        "User-Agent": UA,
        "Referer": realUrl.includes("khmerdrama.com")
          ? "https://www.khmerdrama.com/"
          : "https://www.khmeravenue.com/"
      },
      timeout: 15000
    });

    const html = epRes.data;
    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
    if (!candidate) return { streams: [] };

    const cand = normalizeOkUrl(candidate);

    // If candidate is already direct media URL (.m3u8 or .mp4), return as-is
    if (/\.(m3u8|mp4)(\?|$)/i.test(cand)) {
      return {
        streams: [
          {
            name: "KhmerDub",
            description: "Direct media",
            url: cand
          }
        ]
      };
    }

    // OK.ru resolver
    if (cand.includes("ok.ru")) {
      const src = await resolveOkRuSources(cand, axios, UA);
      const streams = [];

      // Show name + episode number
      const showName = realUrl
        .split("/")
        .filter(Boolean)
        .slice(-1)[0]
        .replace(/-\d+\/?$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      const epNumber = parseInt(realUrl.match(/-(\d+)\//)?.[1] || "1", 10);
      const formattedTitle = `${showName}  S01:E${String(epNumber).padStart(2, "0")}`;

      // 1) Web-ready MP4
      if (src.mp4 && /^https:\/\//i.test(src.mp4)) {
        streams.push({
          name: "KhmerDub (MP4)",
          description: formattedTitle,
          url: src.mp4
        });
      }

      // 2) HLS via proxy
      if (src.hls) {
        streams.push({
          name: "KhmerDub (HLS)",
          description: formattedTitle,
          url: src.hls,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: "https://ok.ru/",
                "User-Agent": UA
              }
            }
          }
        });
      }

      // 3) External
      if (src.page) {
        streams.push({
          name: "Open in Browser",
          description: formattedTitle,
          externalUrl: src.page
        });
      }

      return { streams };
    }

    return { streams: [] };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
