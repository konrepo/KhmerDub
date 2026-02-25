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

builder.defineCatalogHandler(async ({ id }) => {
    if (id !== "khmerave") return { metas: [] };

    try {
        const url = "https://www.khmeravenue.com/album/";

        const { data } = await axios.get(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
            }
        });
		
        const $ = cheerio.load(data);
        const metas = [];

        $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((i, el) => {
            const link = $(el).find("a").attr("href");
            const title = $(el).find("h3").text().trim();

            const style = $(el).find("div[style]").attr("style") || "";
            const match = style.match(/url\((.*?)\)/);
            const poster = match ? match[1] : "";

            if (link && title) {
                metas.push({
                    id: link,
                    type: "series",
                    name: title,
                    poster: poster
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
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
            }
        });

        const $ = cheerio.load(data);

        const episodes = [];
        let epNumber = 1;

        $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]")
            .each((i, el) => {
                const link = $(el).attr("href");
                if (link) {
                    episodes.push({
                        id: link,
                        season: 1,
                        episode: epNumber,
                        name: `Episode ${String(epNumber).padStart(2, "0")}`
                    });
                    epNumber++;
                }
            });

        return {
            meta: {
                id,
                type: "series",
                name: id.split("/").filter(Boolean).pop().replace(/-/g, " "),
                episodes
            }
        };

    } catch (err) {
        console.error("Meta error:", err.message);
        return { meta: null };
    }
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series") return { meta: null };

    try {
        const { data } = await axios.get(id, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            }
        });

        const $ = cheerio.load(data);

        let episodes = [];

        $("#latest-videos a[href]").each((i, el) => {
            const link = $(el).attr("href");

            if (link && link.includes("/videos/")) {
                episodes.push(link);
            }
        });

        // Oldest first (Kodi reversed list)
        episodes = episodes.reverse();

        const formattedEpisodes = episodes.map((link, index) => ({
            id: link,
            season: 1,
            episode: index + 1,
            name: `Episode ${String(index + 1).padStart(2, "0")}`
        }));

        return {
            meta: {
                id,
                type: "series",
                name: id.split("/").filter(Boolean).pop().replace(/-/g, " "),
                episodes: formattedEpisodes
            }
        };

    } catch (err) {
        console.error("Meta error:", err.message);
        return { meta: null };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });