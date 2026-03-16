const TYPE = "series";
const EXTRA = ["search", "skip"];

const sites = [
  { id: "vip", name: "Phumikhmer" },
  { id: "sunday", name: "SundayDrama" },
  { id: "idrama", name: "iDramaHD" },
  { id: "khmerave", name: "KhmerAve" },
  { id: "merlkon", name: "Merlkon" },
];

module.exports = {
  id: "community.khmer.dubbed",
  version: "2.0.0",
  name: "KhmerDub",
  description: "Stream Asian dramas dubbed in Khmer | Dev: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: [TYPE],

  catalogs: sites.map(site => ({
    type: TYPE,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  }
};