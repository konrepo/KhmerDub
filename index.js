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
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36"
            }
        });

        const $ = cheerio.load(data);

        let poster = "";
        const imgDiv = $(".album-content-image");
        if (imgDiv.length) {
            const style = imgDiv.attr("style") || "";
            const match = style.match(/url\((.*?)\)/);
            if (match) poster = match[1];
        }

        let episodes = [];

        $("#latest-videos a[href]").each((i, el) => {
            const link = $(el).attr("href");
            if (link && link.includes("/videos/")) {
                episodes.push(link);
            }
        });

        episodes = episodes.reverse();

        const videos = episodes.map((link, index) => ({
            id: link,
            season: 1,
            episode: index + 1,
            title: `Episode ${String(index + 1).padStart(2, "0")}`
        }));

        return {
            meta: {
                id,
                type: "series",
                name: id.split("/").filter(Boolean).pop().replace(/-/g, " "),
                poster,
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
            }
        });

        const content = data;

        // 1️⃣ options.player_list
        let match = content.match(/options\.player_list\s*=\s*(\[[^\]]+\])\s*;/s);
        if (!match) {
            match = content.match(/const\s+videos\s*=\s*(\[[\s\S]+?\])\s*;/);
        }

        if (match) {
            try {
                let raw = match[1];

                // Clean JS object to valid JSON (same as Kodi)
                raw = raw.replace(/,\s*([\]}])/g, "$1");
                raw = raw.replace(/([{,\s])(\w+)\s*:/g, '$1"$2":');
                raw = raw.replace(/'/g, '"');

                const playerList = JSON.parse(raw);

                if (playerList.length && playerList[0].file) {
                    return {
                        streams: [
                            {
                                title: "KhmerDub",
                                url: playerList[0].file
                            }
                        ]
                    };
                }
            } catch (e) {
                console.error("Player list parse error:", e.message);
            }
        }

        // 2️⃣ Base64 decode fallback
        const base64Match = content.match(/Base64\.decode\("(.+?)"\)/);
        if (base64Match) {
            try {
                const decoded = Buffer.from(base64Match[1], "base64").toString("utf-8");
                const iframeMatch = decoded.match(/<iframe[^>]+src="(.+?)"/i);
                if (iframeMatch) {
                    return {
                        streams: [{ title: "KhmerDub", url: iframeMatch[1] }]
                    };
                }
            } catch {}
        }

        return { streams: [] };

    } catch (err) {
        console.error("Stream error:", err.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });