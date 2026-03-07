const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./manifest");

const engine = require("./sites/engine");
const khmerave = require("./sites/khmerave");
const sites = require("./sites/config");

const ENGINES = {
  vip: engine,
  idrama: engine,
  khmerave: khmerave,
  merlkon: khmerave
};

const builder = new addonBuilder(manifest);

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const pageSize = site.pageSize || 30;
    const skip = Number(extra?.skip || 0);
    const page = Math.floor(skip / pageSize) + 1;

    const site = sites[id];
    if (!site) return { metas: [] };

    const url = extra?.search
      ? `${site.baseUrl}/?s=${encodeURIComponent(extra.search)}`
      : page === 1
      ? site.baseUrl
      : `${site.baseUrl}/page/${page}/`;
	  
    const siteEngine = ENGINES[id];
    if (!siteEngine) return { metas: [] };	  

    const items = await siteEngine.getCatalogItems(id, site, url);

    return {
      metas: items.map((item) => ({
        id: item.id,
        type: "series",
        name: item.name,
        poster: item.poster,
        posterShape: "poster",
      })),
    };
  } catch {
    return { metas: [] };
  }
});

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id }) => {
  try {
    const firstColon = id.indexOf(":");
    if (firstColon === -1) return { meta: null };

    const prefix = id.slice(0, firstColon);
    const encodedUrl = id.slice(firstColon + 1);

    if (!sites[prefix]) return { meta: null };

    const seriesUrl = decodeURIComponent(encodedUrl);

    const siteEngine = ENGINES[prefix];
    if (!siteEngine) return { meta: null };

    const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    return {
      meta: {
        id,
        type: "series",
        name: first.title,
        poster: first.thumbnail,
        background: first.thumbnail,
        videos: episodes,
      },
    };
  } catch (err) {
    return { meta: null };
  }
});

/* =========================
   STREAM
========================= */
builder.defineStreamHandler(async ({ id }) => {
  try {
    const parts = id.split(":");

    let prefix, encodedUrl, episode;

    if (parts.length === 3) {
      [prefix, encodedUrl, episode] = parts;
    } else if (parts.length === 4) {
      prefix = parts[0];
      encodedUrl = parts[1];
      episode = parts[3];
    } else {
      return { streams: [] };
    }

    if (!sites[prefix]) return { streams: [] };

    const epNum = Number(episode);
    if (!Number.isInteger(epNum) || epNum <= 0) {
      return { streams: [] };
    }

    const seriesUrl = decodeURIComponent(encodedUrl);

    const siteEngine = ENGINES[prefix];
    if (!siteEngine) return { streams: [] };

    const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);
    if (!stream) return { streams: [] };

    return { streams: [stream] };

  } catch {
    return { streams: [] };
  }
});

/* =========================
   START SERVER
========================= */
serveHTTP(builder.getInterface(), {
  port: process.env.PORT || 7000,
});

console.log("KhmerDub Addon running on port", process.env.PORT || 7000);