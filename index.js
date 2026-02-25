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

builder.defineCatalogHandler(async () => {
    return { metas: [] };
});

builder.defineMetaHandler(async () => {
    return { metas: [] };
});

builder.defineStreamHandler(async () => {
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });