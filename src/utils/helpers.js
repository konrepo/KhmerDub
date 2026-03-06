function normalizePoster(url) {
  if (!url) return "";
  return url
    .replace(/\/s\d+\//, "/s0/")
    .replace(/=s\d+/, "=s0");
}

function extractVideoLinks(text) {
  const directRegex =
    /https?:\/\/[^\s"';<> ]+\.(?:m3u8|mp4)(?:\?[^\s"';<> ]+)?/gi;

  const okRegex =
    /https?:\/\/ok\.ru\/videoembed\/\d+/gi;

  const playerRegex =
    /https?:\/\/phumikhmer\.vip\/player\.php\?id=\d+/gi;

  const directMatches = text.match(directRegex) || [];
  const okMatches = text.match(okRegex) || [];
  const playerMatches = text.match(playerRegex) || [];

  return Array.from(new Set([
    ...directMatches,
    ...okMatches,
    ...playerMatches
  ]));
}

module.exports = {
  normalizePoster,
  extractVideoLinks
};