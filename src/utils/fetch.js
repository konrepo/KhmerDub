const axios = require("axios");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const axiosClient = axios.create({
  headers: { 
	"User-Agent": USER_AGENT,
	"Accept": "text/html,application/json"
  },
  timeout: 15000,
  maxContentLength: 5 * 1024 * 1024
});

module.exports = axiosClient;