const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 5512);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function checkPassword(password, salt, expectedHash) {
  try {
    const a = crypto.scryptSync(password, salt, 64);
    const b = Buffer.from(expectedHash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan || "free",
    createdAt: user.createdAt,
    history: user.history || [],
    aiUsage: Number(user.aiUsage || 0)
  };
}
function readSessions() { return readJson(SESSIONS_FILE, {}); }
function saveSession(token, userId) {
  const all = readSessions();
  all[token] = { userId, createdAt: new Date().toISOString() };
  writeJson(SESSIONS_FILE, all);
}
function removeSession(token) {
  const all = readSessions();
  delete all[token];
  writeJson(SESSIONS_FILE, all);
}
function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}
function getCurrentUser(req) {
  const token = bearer(req);
  const userId = readSessions()[token]?.userId;
  if (!userId || userId === "__admin__") return null;
  return readJson(USERS_FILE, []).find(u => u.id === userId) || null;
}
function isAdmin(req) {
  return readSessions()[bearer(req)]?.userId === "__admin__";
}
function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    ".html":"text/html; charset=utf-8",
    ".css":"text/css; charset=utf-8",
    ".js":"application/javascript; charset=utf-8",
    ".json":"application/json; charset=utf-8",
    ".png":"image/png",
    ".jpg":"image/jpeg",
    ".jpeg":"image/jpeg",
    ".svg":"image/svg+xml",
    ".ico":"image/x-icon"
  }[ext] || "application/octet-stream";
}
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: "File not found." });
    res.writeHead(200, { "Content-Type": mimeType(file), "Cache-Control": "no-cache" });
    res.end(data);
  });
}
function localMathAssistant(message) {
  const m = String(message).match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return "OpenRouter is not configured yet. Add OPENROUTER_API_KEY to the .env file and restart the app.";
  const a=Number(m[1]), op=m[2], b=Number(m[3]);
  let result;
  if(op==="+") result=a+b;
  if(op==="-") result=a-b;
  if(op==="*") result=a*b;
  if(op==="/") result=b===0 ? "undefined" : a/b;
  return `Step 1: Identify the operation ${op}.\nStep 2: Calculate ${a} ${op} ${b}.\nAnswer: ${result}.`;
}

async function handleApi(req, res, pathname) {
  try {
    const body = ["POST","PATCH","PUT"].includes(req.method) ? await parseBody(req) : {};

    if (pathname === "/api/signup" && req.method === "POST") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (name.length < 2) return json(res, 400, { error: "Enter your name." });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: "Enter a valid email." });
      if (password.length < 6) return json(res, 400, { error: "Password must have at least 6 characters." });

      const users = readJson(USERS_FILE, []);
      if (users.some(u => u.email === email)) return json(res, 409, { error: "This email already has an account." });

      const pw = hashPassword(password);
      const user = {
        id: crypto.randomUUID(), name, email,
        passwordHash: pw.hash, salt: pw.salt,
        plan: "free", history: [], aiUsage: 0, createdAt: new Date().toISOString()
      };
      users.push(user);
      writeJson(USERS_FILE, users);
      const token = crypto.randomBytes(32).toString("hex");
      saveSession(token, user.id);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (pathname === "/api/login" && req.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const users = readJson(USERS_FILE, []);
      const user = users.find(u => u.email === email);
      if (!user || !checkPassword(password, user.salt, user.passwordHash)) {
        return json(res, 401, { error: "Incorrect email or password." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      saveSession(token, user.id);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (pathname === "/api/admin/login" && req.method === "POST") {
      if (String(body.password || "") !== (process.env.ADMIN_PASSWORD || "RICA@2006")) {
        return json(res, 401, { error: "Incorrect admin password." });
      }
      const token = "admin_" + crypto.randomBytes(24).toString("hex");
      saveSession(token, "__admin__");
      return json(res, 200, { token });
    }

    const user = getCurrentUser(req);

    if (pathname === "/api/me" && req.method === "GET") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      return json(res, 200, { user: publicUser(user) });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      removeSession(bearer(req));
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/profile" && req.method === "PATCH") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      const name = String(body.name || "").trim();
      if (name.length < 2) return json(res, 400, { error: "Enter a valid name." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === user.id);
      found.name = name.slice(0, 80);
      writeJson(USERS_FILE, users);
      return json(res, 200, { user: publicUser(found) });
    }

    if (pathname === "/api/history" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === user.id);
      found.history = Array.isArray(found.history) ? found.history : [];
      found.history.unshift({
        id: crypto.randomUUID(),
        expression: String(body.expression || "").slice(0, 200),
        result: String(body.result || "").slice(0, 200),
        createdAt: new Date().toISOString()
      });
      found.history = found.history.slice(0, 25);
      writeJson(USERS_FILE, users);
      return json(res, 200, { history: found.history });
    }

    if (pathname === "/api/history" && req.method === "DELETE") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === user.id);
      found.history = [];
      writeJson(USERS_FILE, users);
      return json(res, 200, { history: [] });
    }

    if (pathname === "/api/subscription/activate-demo" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === user.id);
      found.plan = "premium";
      writeJson(USERS_FILE, users);
      return json(res, 200, { user: publicUser(found), message: "AI Premium activated in demo mode." });
    }

    if (pathname === "/api/subscription/cancel" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === user.id);
      found.plan = "free";
      writeJson(USERS_FILE, users);
      return json(res, 200, { user: publicUser(found), message: "AI Premium cancelled." });
    }

    if (pathname === "/api/ai/chat" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "Please log in again." });
      if (user.plan !== "premium") return json(res, 403, { error: "AI Math Assistant requires AI Premium." });

      const message = String(body.message || "").trim().slice(0, 1500);
      if (!message) return json(res, 400, { error: "Write a math question first." });

      const apiKey = process.env.OPENROUTER_API_KEY;
      const requestedModel = String(body.model || "").trim();
      const model = requestedModel || process.env.OPENROUTER_MODEL || "openrouter/free";
      if (!apiKey) return json(res, 200, { answer: localMathAssistant(message), mode: "local-demo" });

      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL || `http://localhost:${PORT}`,
            "X-OpenRouter-Title": "UBX Calculator AI"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: "You are UBX Math AI. Explain math clearly, briefly, step by step, and verify every answer."
              },
              {
                role: "user",
                content: message
              }
            ],
            temperature: 0.25,
            max_tokens: 700
          })
        });

        const data = await response.json();
        if (!response.ok) {
          return json(res, response.status === 429 ? 429 : 502, {
            error: data?.error?.message || "OpenRouter returned an error. Check the API key, model, and credits."
          });
        }

        const content = data?.choices?.[0]?.message?.content;
        const answer = typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content.map(part => part?.text || "").join("\n").trim()
            : "";

        const users = readJson(USERS_FILE, []);
        const found = users.find(u => u.id === user.id);
        if (found) {
          found.aiUsage = Number(found.aiUsage || 0) + 1;
          writeJson(USERS_FILE, users);
        }
        return json(res, 200, {
          answer: answer || "OpenRouter returned an empty response.",
          mode: "openrouter",
          model: data.model || model
        });
      } catch (error) {
        console.error(error);
        return json(res, 502, { error: "Unable to connect to OpenRouter." });
      }
    }

    if (pathname === "/api/public-settings" && req.method === "GET") {
      return json(res, 200, readJson(SETTINGS_FILE, {
        premiumPrice: 4.99,
        announcement: "AI Premium is now available."
      }));
    }

    if (pathname === "/api/admin/dashboard" && req.method === "GET") {
      if (!isAdmin(req)) return json(res, 401, { error: "Admin access required." });
      const users = readJson(USERS_FILE, []);
      const settings = readJson(SETTINGS_FILE, { premiumPrice:4.99, announcement:"AI Premium is now available." });
      return json(res, 200, {
        users: users.map(publicUser),
        settings,
        stats: {
          totalUsers: users.length,
          premiumUsers: users.filter(u => u.plan === "premium").length,
          freeUsers: users.filter(u => u.plan !== "premium").length,
          aiRequests: users.reduce((sum,u)=>sum+Number(u.aiUsage||0),0)
        }
      });
    }

    const userMatch = pathname.match(/^\/api\/admin\/user\/([^/]+)$/);
    if (userMatch && req.method === "PATCH") {
      if (!isAdmin(req)) return json(res, 401, { error:"Admin access required." });
      const users = readJson(USERS_FILE, []);
      const found = users.find(u => u.id === userMatch[1]);
      if (!found) return json(res, 404, { error:"User not found." });
      if (["free","premium"].includes(body.plan)) found.plan = body.plan;
      writeJson(USERS_FILE, users);
      return json(res, 200, { user:publicUser(found) });
    }
    if (userMatch && req.method === "DELETE") {
      if (!isAdmin(req)) return json(res, 401, { error:"Admin access required." });
      writeJson(USERS_FILE, readJson(USERS_FILE, []).filter(u => u.id !== userMatch[1]));
      return json(res, 200, { ok:true });
    }

    if (pathname === "/api/admin/settings" && req.method === "PATCH") {
      if (!isAdmin(req)) return json(res, 401, { error:"Admin access required." });
      const settings = readJson(SETTINGS_FILE, { premiumPrice:4.99, announcement:"" });
      const price = Number(body.premiumPrice);
      if (!Number.isFinite(price) || price < 0.99 || price > 4.99) {
        return json(res, 400, { error:"Price must be between $0.99 and $4.99." });
      }
      settings.premiumPrice = Number(price.toFixed(2));
      settings.announcement = String(body.announcement || "").slice(0,300);
      writeJson(SETTINGS_FILE, settings);
      return json(res, 200, { settings });
    }

    return json(res, 404, { error:"API route not found." });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error:"Server error." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    return handleApi(req, res, pathname);
  }

  let file = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  const safePublic = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(file);

  if (!resolved.startsWith(safePublic)) return json(res, 403, { error:"Forbidden." });
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return serveFile(res, resolved);

  return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
});

server.listen(PORT, () => {
  console.log(`UBX Calculator AI running at http://localhost:${PORT}`);
  console.log(`Admin password: ${process.env.ADMIN_PASSWORD || "RICA@2006"}`);
  console.log(process.env.OPENROUTER_API_KEY ? "OpenRouter AI: configured" : "OpenRouter AI: local demo mode");
});
