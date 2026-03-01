const { addonBuilder } = require("stremio-addon-sdk");

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
                if (link) {
                    episodes.push(link);
                }
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
    console.log("OK Resolver: Fetching embed:", okUrl);

    const okRes = await axios.get(okUrl, {
      headers: {
        "User-Agent": ua,
        "Referer": "https://ok.ru/"
      },
      timeout: 15000
    });

    let html = okRes.data;
    if (typeof html !== "string") {
      html = String(html);
    }

    console.log("OK Resolver: Embed page loaded");

    // Decode common escapes
    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");

    // Try extracting from data-options JSON
    const optionsMatch = html.match(/data-options="([^"]+)"/);

    if (optionsMatch?.[1]) {
      console.log("OK Resolver: Found data-options JSON");

      try {
        const decoded = optionsMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');

        const optionsJson = JSON.parse(decoded);

        if (optionsJson?.flashvars?.metadata) {
          const metadata = JSON.parse(optionsJson.flashvars.metadata);

          if (metadata?.ondemandHls) {
            console.log("OK Resolver: HLS found via data-options (ondemandHls)");
            console.log("FINAL HLS URL:", metadata.ondemandHls);
            return metadata.ondemandHls;
          }

          if (metadata?.hlsManifestUrl) {
            console.log("OK Resolver: HLS found via data-options (hlsManifestUrl)");
            console.log("FINAL HLS URL:", metadata.hlsManifestUrl);
            return metadata.hlsManifestUrl;
          }
        }
      } catch (err) {
        console.log("OK Resolver: data-options parse failed");
      }
    } else {
      console.log("OK Resolver: No data-options found");
    }

    // Fallback: inline HLS keys
    const inlinePatterns = [
      { name: "ondemandHls", re: /"ondemandHls"\s*:\s*"([^"]+)/ },	
      { name: "hlsManifestUrl", re: /"hlsManifestUrl"\s*:\s*"([^"]+)/ },
      { name: "hlsMasterPlaylistUrl", re: /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)/ }
    ];

    for (const p of inlinePatterns) {
      const m = html.match(p.re);
      if (m?.[1]) {

        const url = m[1];

        // Skip non-playable videoPlayerCdn URLs
        if (url.includes("videoPlayerCdn")) {
          console.log("Skipping videoPlayerCdn URL (not playable)");
          continue;
        }

        console.log(`OK Resolver: HLS found via inline key (${p.name})`);
        console.log("FINAL HLS URL:", url);
        return url;
      }
    }

    console.log("OK Resolver: No HLS URL found");
    return null;

  } catch (err) {
    console.error("OK Resolver error:", err.message);
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

    // Extract show name from URL
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
          url: `https://khmerdub.onrender.com/proxy?url=${encodeURIComponent(direct)}`,
          season: 1,
          episode: 1,
          behaviorHints: {
            notWebReady: true
          }
        }
      ]
    };

  } catch {
    return { streams: [] };
  }
}


builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };
  
  const realUrl = Buffer.from(id, "base64")
    .toString("utf8")
    .replace("#ep1", "");
  
  const UA =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

  // Detect EP1 (album page)
  if (realUrl.includes("/album/")) {
    return await handleEpisodeOne(realUrl, UA);
  }

  try {
    // Fetch episode page
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

    // Extract candidate link
    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);

    if (!candidate) return { streams: [] };

    const cand = normalizeOkUrl(candidate);

    // OK.ru resolver
    if (cand.includes("ok.ru")) {
      const direct = await resolveOkRuToDirect(cand, axios, UA);

      if (!direct) return { streams: [] };
	  
	  // Extract show name from URL	  
	  const showName = realUrl
        .split("/")
        .filter(Boolean)
        .slice(-1)[0]
        .replace(/-\d+$/, "") // remove episode number
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
	  
	  const epNumber = parseInt(
        realUrl.match(/-(\d+)\//)?.[1] || "1",
        10
	  );

	  const formattedTitle = `${showName}  S01:E${String(epNumber).padStart(2, "0")}`;

      return {
        streams: [
          {
            title: formattedTitle,
            url: `https://khmerdub.onrender.com/proxy?url=${encodeURIComponent(direct)}`,
			season: 1,
			episode: epNumber,
            behaviorHints: {
              notWebReady: true
            }
          }
        ]
      };
    }

    // If candidate is already a direct media URL (.m3u8 or .mp4), return as-is
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

const express = require("express");

const app = express();
const addonInterface = builder.getInterface();

// Manifest
app.get("/manifest.json", (req, res) => {
  res.json(addonInterface.manifest);
});

// Proxy endpoint (must come before dynamic route)
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing url");

  try {
    const response = await axios.get(targetUrl, {
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36",
        "Referer": "https://ok.ru/"
      }
    });

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "application/vnd.apple.mpegurl"
    );

    response.data.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Proxy failed");
  }
});

// Dynamic addon route (must be last)
app.get("/:resource/:type/:id.json", (req, res) => {
  addonInterface
    .get(req)
    .then(resp => res.json(resp))
    .catch(err => {
      console.error("Addon error:", err);
      res.status(500).send("Addon error");
    });
});

const port = process.env.PORT || 7000;
app.listen(port, () => {
  console.log("Addon running on port", port);
});