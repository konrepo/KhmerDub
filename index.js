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
        // Pagination support
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
                    id: link,
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

    try {
        const { data } = await axios.get(id, {
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

        // Collect episode links (exact Kodi selector)
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
            id: link,
            season: 1,
            episode: index + 1,
            title: `Episode ${String(index + 1).padStart(2, "0")}`,
            thumbnail: poster
        }));

        return {
            meta: {
                id,
                type: "series",
                name: pageTitle || id.split("/").filter(Boolean).pop().replace(/-/g, " "),
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

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "series") return { streams: [] };

    try {
        const { data } = await axios.get(id, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);

        // Look for OK.ru iframe
        const iframe = $("iframe[src*='ok.ru']").attr("src");

        if (!iframe) {
            return { streams: [] };
        }

        console.log("OK.RU EMBED:", iframe);

        // Fetch OK.ru embed page
        const okRes = await axios.get(iframe, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            },
            timeout: 15000
        });

        const okHtml = okRes.data;

        console.log("OK.RU PAGE LENGTH:", okHtml.length);

        // Extract direct m3u8 or mp4 link
        const regex = /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi;
        const matches = okHtml.match(regex);

        if (matches && matches.length) {
            console.log("EXTRACTED DIRECT STREAM:", matches[0]);

            return {
                streams: [
                    {
                        title: "KhmerDub",
                        url: matches[0]
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