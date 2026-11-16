const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.QF_CLIENT_ID;
const CLIENT_SECRET = process.env.QF_CLIENT_SECRET;
const ENV = process.env.QF_ENV || "prelive";

const ENVIRONMENTS = {
  prelive: {
    auth: "https://prelive-oauth2.quran.foundation",
    api: "https://apis-prelive.quran.foundation"
  },
  production: {
    auth: "https://oauth2.quran.foundation",
    api: "https://apis.quran.foundation"
  }
};

const config = ENVIRONMENTS[ENV];
let cachedToken = null;
let tokenExpiresAt = 0;

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "https://genzchamp.github.io",
    "Vary": "Origin"
  });
  res.end(JSON.stringify(body));
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Server credentials are not configured");
  if (!config) throw new Error("QF_ENV must be prelive or production");

  const basic = Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64");
  const response = await fetch(config.auth + "/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "content.quran.read content.translations.read"
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Quran Foundation token request failed:", response.status, details.slice(0, 500));
    throw new Error("Quran Foundation authentication failed (" + response.status + ")");
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function qfGet(path, label) {
  const token = await getAccessToken();
  const response = await fetch(config.api + "/content/api/v4" + path, {
    headers: {
      "x-auth-token": token,
      "x-client-id": CLIENT_ID
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Quran Foundation " + label + " request failed:", response.status, details.slice(0, 500));
    throw new Error("Quran Foundation " + label + " request failed (" + response.status + ")");
  }
  return response.json();
}

async function getChapters() {
  return qfGet("/chapters", "chapters");
}

async function getChapterVerses(chapter, page) {
  const params = new URLSearchParams({
    language: "en",
    words: "false",
    translations: "131",
    fields: "text_uthmani",
    per_page: "50",
    page: String(page)
  });
  return qfGet("/verses/by_chapter/" + chapter + "?" + params.toString(), "verses");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== "https://genzchamp.github.io") {
    return send(res, 403, { error: "Origin not allowed" });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "https://genzchamp.github.io",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    });
    return res.end();
  }

  const path = new URL(req.url, "http://localhost").pathname;
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

  if (path === "/api/health") {
    return send(res, 200, { ok: true, service: "ihsan-api", environment: ENV });
  }

  if (path === "/api/chapters") {
    try {
      const data = await getChapters();
      return send(res, 200, data);
    } catch (error) {
      return send(res, 502, { error: error.message || "Unable to retrieve chapters" });
    }
  }

  const verseMatch = /^\/api\/chapters\/(\d+)\/verses$/.exec(path);
  if (verseMatch) {
    const chapter = Number(verseMatch[1]);
    const page = Number(new URL(req.url, "http://localhost").searchParams.get("page") || 1);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 114 ||
        !Number.isInteger(page) || page < 1 || page > 100) {
      return send(res, 400, { error: "Invalid chapter or page" });
    }
    try {
      const data = await getChapterVerses(chapter, page);
      return send(res, 200, data);
    } catch (error) {
      return send(res, 502, { error: error.message || "Unable to retrieve verses" });
    }
  }

  return send(res, 404, { error: "Route not found", path });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Ihsan API listening on port " + PORT);
});