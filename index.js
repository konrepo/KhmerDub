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

builder.defineMetaHandler(async () => {
    return { metas: [] };
});

builder.defineStreamHandler(async () => {
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });