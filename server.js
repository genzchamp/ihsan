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
      scope: "content.quran.read"
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

async function getChapters() {
  const token = await getAccessToken();
  const response = await fetch(config.api + "/content/api/v4/chapters", {
    headers: {
      "x-auth-token": token,
      "x-client-id": CLIENT_ID
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Quran Foundation chapters request failed:", response.status, details.slice(0, 500));
    throw new Error("Quran Foundation content request failed (" + response.status + ")");
  }
  return response.json();
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

  return send(res, 404, { error: "Route not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Ihsan API listening on port " + PORT);
});