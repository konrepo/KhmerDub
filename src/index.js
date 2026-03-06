const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./manifest");

const engine = require("./sites/engine");
const sites = require("./sites/config");

const builder = new addonBuilder(manifest);

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const pageSize = 30;
    const skip = Number(extra?.skip || 0);
    const page = Math.floor(skip / pageSize) + 1;

    const site = sites[id];
    if (!site) return { metas: [] };

    const url = extra?.search
      ? `${site.baseUrl}/?s=${encodeURIComponent(extra.search)}`
      : page === 1
      ? site.baseUrl
      : `${site.baseUrl}/page/${page}/`;

    const items = await engine.getCatalogItems(id, site, url);

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
    const [prefix, postId] = id.split(":");
    if (!sites[prefix]) return { meta: null };

    const episodes = await engine.getEpisodes(prefix, postId);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    return {
      meta: {
        id: `${prefix}:${postId}`,
        type: "series",
        name: first.title,
        poster: first.thumbnail,
        background: first.thumbnail,
        videos: episodes,
      },
    };

  } catch {
    return { meta: null };
  }
});

/* =========================
   STREAM
========================= */
builder.defineStreamHandler(async ({ id }) => {
  try {
    const parts = id.split(":");

    let prefix, postId, episode;
    if (parts.length === 3) {
      [prefix, postId, episode] = parts;
    } else if (parts.length === 4) {
      prefix = parts[0];
      postId = parts[1];
      episode = parts[3];
    } else {
      return { streams: [] };
    }

    if (!sites[prefix]) return { streams: [] };

    const epNum = Number(episode);
    if (!Number.isInteger(epNum) || epNum <= 0) {
      return { streams: [] };
    }

    const stream = await engine.getStream(prefix, postId, epNum);
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