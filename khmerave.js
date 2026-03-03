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

				let text = $(el).text().trim();
				text = text.replace(/\s+/g, " ");
				
				// Exclude ONLY exact "Episode 0" or "Episode 1"
				if (/^Episode\s+0$/i.test(text)) return;
				if (/^Episode\s+1$/i.test(text)) return;
				
				 episodes.push(link);
            });

        if (episodes.length) {
            episodes = [...new Set(episodes)];
            episodes = episodes.reverse();
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

    let match = null;

    const patterns = [
      /"ondemandHls"\s*:\s*"([^"]+)/,
      /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)/,
      /"hlsManifestUrl"\s*:\s*"([^"]+)/,
      /"metadataUrl"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/,
      /"(https:[^"]+\.m3u8[^"]*)"/
    ];

    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        match = m;
        break;
      }
    }

    if (!match || !match[1]) {	
      return null;
    }

    const cleanUrl = match[1].replace(/\\&/g, "&");

    return cleanUrl;

  } catch (err) {
    console.error("OK resolver error:", err.message);  
    return null;
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
    const direct = await resolveOkRuToDirect(cand, axios, UA);

    if (!direct) return { streams: [] };

    const showName = url
      .split("/")
      .filter(Boolean)
      .slice(-1)[0]
      .replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());

    const formattedTitle = `${showName}  S01:E01`;

    return {
      streams: [
        {
          title: formattedTitle,
          url: direct
        }
      ]
    };

  } catch (err) {
    console.error("EP1 error:", err.message);
    return { streams: [] };
  }
}

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };

  const BASE_URL =
    process.env.RENDER_EXTERNAL_URL ||
    "https://khmerdub-test.onrender.com";

  const realUrl = Buffer.from(id, "base64")
    .toString("utf8")
    .replace("#ep1", "");

  const UA =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

  // Detect EP1 (album page)
  if (realUrl.includes("/album/")) {
    const result = await handleEpisodeOne(realUrl, UA);

    if (result?.streams?.length) {
      const original = result.streams[0].url;

      // Proxy ONLY okcdn / ok.ru streams
      if (original.includes("okcdn.ru") || original.includes("ok.ru")) {
        result.streams[0].url =
          `${BASE_URL}/proxy?url=${encodeURIComponent(original)}`;
      }

      result.streams[0].behaviorHints = { notWebReady: true };
      delete result.streams[0].season;
      delete result.streams[0].episode;
    }

    return result;
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

    // ===== OK.RU HANDLING =====
    if (cand.includes("ok.ru")) {
      const direct = await resolveOkRuToDirect(cand, axios, UA);
      if (!direct) return { streams: [] };

      const showName = realUrl
        .split("/")
        .filter(Boolean)
        .slice(-1)[0]
        .replace(/-\d+$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      const epNumber = parseInt(
        realUrl.match(/-(\d+)\//)?.[1] || "1",
        10
      );

      const formattedTitle =
        `${showName}  S01:E${String(epNumber).padStart(2, "0")}`;

      const proxyUrl =
        `${BASE_URL}/proxy?url=${encodeURIComponent(direct)}`;

      return {
        streams: [
          {
            title: formattedTitle,
            url: proxyUrl,
            behaviorHints: {
              notWebReady: true
            }
          }
        ]
      };
    }

    // ===== DIRECT HLS / MP4 =====
    if (/\.(m3u8|mp4)(\?|$)/i.test(cand)) {
      return {
        streams: [
          {
            title: "KhmerDub",
            url: cand,
            behaviorHints: {
              notWebReady: true
            }
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


const server = http.createServer(async (req, res) => {
  console.log("Incoming request:", req.method, req.url);

  const parsed = url.parse(req.url, true);

  // ===== PROXY ROUTE =====
  if (parsed.pathname === "/proxy") {
    console.log("Proxy route hit");

    const target = parsed.query.url;
    console.log("Proxy target:", target);

    if (!target) {
      res.statusCode = 400;
      return res.end("Missing url");
    }

    try {
      const isPlaylist = target.includes(".m3u8");
      console.log("Is playlist:", isPlaylist);

      const response = await axios.get(target, {
        headers: {
          Referer: "https://ok.ru/",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
        },
        responseType: isPlaylist ? "text" : "stream"
      });

      console.log("Fetched from OK.ru successfully");

      if (isPlaylist) {
        let body = response.data;

        const base = target.substring(0, target.lastIndexOf("/") + 1);

        body = body.replace(
          /^([^#\r\n][^\r\n]*)/gm,
          (line) => {
            if (line.startsWith("http")) {
              return `/proxy?url=${encodeURIComponent(line)}`;
            }
            if (!line.startsWith("#")) {
              return `/proxy?url=${encodeURIComponent(base + line)}`;
            }
            return line;
          }
        );

        console.log("Playlist rewritten");

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        return res.end(body);
      }

      console.log("Streaming segment...");
      response.data.pipe(res);
      return;

    } catch (err) {
      console.error("Proxy error:", err.message);
      res.statusCode = 500;
      return res.end("Proxy failed");
    }
  }

  // Otherwise pass to Stremio addon
  addonServer(req, res);
});
