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

function extractMaxEpFromTitle(title) {
  if (!title) return null;

  const match =
    title.match(/\bEP\.?\s*(\d+)\b/i) ||
    title.match(/\bEpisode\s*(\d+)\b/i) ||
    title.match(/\[EP\.?\s*(\d+)\]/i);

  return match ? parseInt(match[1], 10) : null;
}

module.exports = {
  normalizePoster,
  extractVideoLinks,
  extractMaxEpFromTitle
};