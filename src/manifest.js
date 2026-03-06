module.exports = {
  id: "community.khmer.dubbed",
  version: "1.1.0",
  name: "KhmerDub",
  description: "Stream Asian dramas dubbed in Khmer | Dev: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "vip",
      name: "Phumikhmer",
      extraSupported: ["search", "skip"],
    },
    {
      type: "series",
      id: "idrama",
      name: "iDramaHD",
      extraSupported: ["search", "skip"],
    },
  ],
};