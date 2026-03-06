const URL_TO_POSTID = new Map(); // seriesUrl -> postId
const POST_INFO = new Map();     // postId -> { maxEp?, detail? }

const BLOG_IDS = {
  TVSABAY: "8016412028548971199",
  ONELEGEND: "596013908374331296",
  KOLAB: "7770980406614294729"
};

function getMaxEpFromSeriesPage(postId) {
  return POST_INFO.get(postId)?.maxEp || null;
}

module.exports = {
  URL_TO_POSTID,
  POST_INFO,
  BLOG_IDS,
  getMaxEpFromSeriesPage
};