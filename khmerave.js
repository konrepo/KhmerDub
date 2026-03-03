const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

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

/**
 * IMPORTANT for iOS:
 * - Always return HTTPS proxy URLs (your Render URL is HTTPS)
 * - Use /proxy for OK.ru / okcdn m3u8 and segments
 */
function getBaseUrl() {
    const envUrl =
        process.env.RENDER_EXTERNAL_URL ||
        process.env.ADDON_URL ||
        "https://khmerdub-test.onrender.com";

    // Force https if someone accidentally sets http
    return envUrl.replace(/^http:\/\//i, "https://");
}

function tryExtractVideoCandidateFromKhmerAvenue(html) {
    // Base64.decode("....")
    const b64 = html.match(/Base64\.decode\("(.+?)"\)/i);
    if (b64?.[1]) {
        try {
            const decoded = Buffer.from(b64[1], "base64").toString("utf8");
            const iframe = decoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframe?.[1]) return iframe[1];
        } catch {}
    }

    // Patterns
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

function normalizeOkUrl(url) {
    if (!url) return url;
    if (url.startsWith("//")) return "https:" + url;
    return url;
}

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

        // Decode escaping
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
            if (m?.[1]) {
                return m[1].replace(/\\&/g, "&");
            }
        }

        return null;
    } catch (err) {
        console.error("OK resolver error:", err.message);
        return null;
    }
}

function absoluteUrlFrom(base, maybeRelative) {
    try {
        return new URL(maybeRelative, base).toString();
    } catch {
        return maybeRelative;
    }
}

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async (args) => {
    const { id, extra } = args;
    if (id !== "khmerave" && id !== "merlkon") return { metas: [] };

    try {
        // Search
        if (extra?.search) {
            const keyword = encodeURIComponent(extra.search);
            let url;

            if (id === "khmerave") url = `https://www.khmeravenue.com/?s=${keyword}`;
            if (id === "merlkon") url = `https://www.khmerdrama.com/?s=${keyword}`;

            const { data } = await axios.get(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                    "Referer":
                        id === "merlkon" ? "https://www.khmerdrama.com/" : "https://www.khmeravenue.com/"
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
        // End search

        const skip = parseInt(extra?.skip || "0", 10);

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
                    "Referer":
                        id === "merlkon" ? "https://www.khmerdrama.com/" : "https://www.khmeravenue.com/"
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

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series") return { meta: null };

    const realUrl = Buffer.from(id, "base64").toString("utf8");

    try {
        const { data } = await axios.get(realUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            },
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

        // Episode list (handles weird Episode 0 and bad Episode 1 post_type)
        let episodes = [];

        $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]").each((i, el) => {
            const link = $(el).attr("href");
            if (!link) return;

            // Exclude random post_type video (bad Episode 1)
            if (link.includes("?post_type=videos")) return;

            let epNumber = 1;

            // Album page = Episode 1
            if (!link.includes("/album/")) {
                // Special: some pages show "Episode 0" but URL is "...-20-end/" (no digits)
                // We compute epNumber from URL digits if exist, else leave as 1
                const m = link.match(/-(\d+)/);
                if (m) {
                    epNumber = parseInt(m[1], 10);
                } else {
                    // If no digits but looks like "-end" or similar, try to read from text "Episode 0/20"
                    // Keep it simple: if link includes "end" and we can't parse digits, set to 20 (your request)
                    if (/end/i.test(link)) epNumber = 20;
                }
            }

            episodes.push({ link, epNumber });
        });

        if (episodes.length) {
            episodes = [...new Map(episodes.map((e) => [e.link, e])).values()];
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

/* =========================
   STREAM
========================= */

// EP1 handler: always proxy OKRU/OKCDN for iOS reliability
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

        // Resolve ok.ru embed -> direct m3u8 (better than returning embed URL)
        let direct = cand;
        if (cand.includes("ok.ru")) {
            const resolved = await resolveOkRuToDirect(cand, UA);
            if (resolved) direct = resolved;
        }

        if (!direct) return { streams: [] };

        const showName = url
            .split("/")
            .filter(Boolean)
            .slice(-1)[0]
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

        const formattedTitle = `${showName}  S01:E01`;

        const BASE_URL = getBaseUrl();
        const proxied = `${BASE_URL}/proxy?url=${encodeURIComponent(decodeURIComponent(direct))}`;

        console.log("EP1 direct:", direct);
        console.log("EP1 proxy :", proxied);

        return {
            streams: [
                {
                    title: formattedTitle,
                    url: proxied,
                    behaviorHints: {
                        notWebReady: true
                    }
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

    const realUrl = Buffer.from(id, "base64").toString("utf8").replace("#ep1", "");

    const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

    // EP1 album page
    if (realUrl.includes("/album/")) {
        return await handleEpisodeOne(realUrl, UA);
    }

    try {
        const epRes = await axios.get(realUrl, {
            headers: {
                "User-Agent": UA,
                "Referer": realUrl.includes("khmerdrama.com") ? "https://www.khmerdrama.com/" : "https://www.khmeravenue.com/"
            },
            timeout: 15000
        });

        const html = epRes.data;
        const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
        if (!candidate) return { streams: [] };

        const cand = normalizeOkUrl(candidate);

        let direct = cand;

        // If OK embed, try to resolve to m3u8
        if (cand.includes("ok.ru")) {
            const resolved = await resolveOkRuToDirect(cand, UA);
            if (resolved) direct = resolved;
        }

        if (!direct) return { streams: [] };

        // Build title
        const showName = realUrl
            .split("/")
            .filter(Boolean)
            .slice(-1)[0]
            .replace(/-\d+$/, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

        const epNumber = parseInt(realUrl.match(/-(\d+)\//)?.[1] || "1", 10);
        const formattedTitle = `${showName}  S01:E${String(epNumber).padStart(2, "0")}`;

        const BASE_URL = getBaseUrl();

        const shouldProxy =
            /okcdn\.ru/i.test(direct) ||
            /ok\.ru/i.test(direct) ||
            /\.m3u8(\?|$)/i.test(direct);

        const normalizedDirect = (() => {
            try {
                return decodeURIComponent(direct);
            } catch {
                return direct; // if not encoded, leave it
            }
        })();

        const finalUrl = shouldProxy
            ? `${BASE_URL}/proxy?url=${encodeURIComponent(normalizedDirect)}`
            : direct;

        console.log("Stream page :", realUrl);
        console.log("Candidate   :", cand);
        console.log("Direct      :", direct);
        console.log("Final URL   :", finalUrl);

        return {
            streams: [
                {
                    title: formattedTitle,
                    url: finalUrl,
                    behaviorHints: {
                        notWebReady: true
                    }
                }
            ]
        };
    } catch (err) {
        console.error("Stream error:", err.message);
        return { streams: [] };
    }
});

/* =========================
   EXPRESS + PROXY + SERVEHTTP
========================= */

const app = express();

// Basic request logging (so you always see something on Render)
app.use((req, res, next) => {
    console.log("[HTTP]", req.method, req.originalUrl);
    next();
});

// PROXY (must be BEFORE serveHTTP mounts)
app.get("/proxy", async (req, res) => {
    const target = req.query.url;

    console.log("==== PROXY REQUEST ====");
    console.log("Incoming:", req.method, req.originalUrl);
    console.log("Target  :", target);

    if (!target) return res.status(400).send("Missing url");

    // iOS often needs CORS on the proxy response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");

    try {
        const isPlaylist = /\.m3u8(\?|$)/i.test(target);

        // Forward Range if present (very important for iOS)
        const range = req.headers.range;

        const response = await axios.get(target, {
            headers: {
                Referer: "https://ok.ru/",
                "User-Agent":
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                ...(range ? { Range: range } : {})
            },
            timeout: 20000,
            responseType: isPlaylist ? "text" : "stream",
            maxRedirects: 5,
            validateStatus: () => true
        });

        // Pass through status (200/206/302/etc)
        res.status(response.status);

        // Pass through key headers iOS cares about
        const passthroughHeaders = [
            "content-type",
            "content-length",
            "accept-ranges",
            "content-range",
            "cache-control",
            "expires",
            "last-modified"
        ];

        for (const h of passthroughHeaders) {
            const val = response.headers?.[h];
            if (val) res.setHeader(h, val);
        }

        if (isPlaylist) {
            const base = target.substring(0, target.lastIndexOf("/") + 1);
            let body = response.data;

            body = body
                .split("\n")
                .map((line) => {
                    const trimmed = line.trim();

                    // Keep comments & empty lines untouched
                    if (!trimmed || trimmed.startsWith("#")) {
                        return line;
                    }

                    const abs = absoluteUrlFrom(base, trimmed);

                    // Avoid double-encoding URLs that already contain %xx
                    const normalizedAbs = (() => {
                        try {
                            return decodeURIComponent(abs);
                        } catch {
                            return abs;
                        }
                    })();

                    return `/proxy?url=${encodeURIComponent(normalizedAbs)}`;
                })
                .join("\n");

            // Force correct playlist content-type
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            console.log("Proxy playlist OK");
            return res.send(body);
        }

        console.log("Proxy segment/media OK");
        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy error:", err.message);
        return res.status(500).send("Proxy failed");
    }
});

// Mount Stremio addon AFTER proxy
serveHTTP(builder.getInterface(), {
    port: process.env.PORT || 7000,
    app
});

console.log("KhmerDub addon booting...");
console.log("Base URL:", getBaseUrl());
