"use strict";

const ADMIN_VIEW = "admin:view_info";
const ADMIN_EDIT = "admin:edit_info";
const ADMIN_CREATE = "admin:create_info";
const ADMIN_DELETE = "admin:delete_info";
const ADMIN_ADD_LIST_STAR = "admin:add_list_star";

const VIEW_CONTINUE = "view:continue_query";
const VIEW_EXIT = "view:exit_query";
const VIEW_EDIT = "view:edit_info";

const EDIT_SELECT = "edit:select_field";
const EDIT_INPUT = "edit:input_value";
const EDIT_CONFIRM = "edit:confirm_value";
const CREATE_WAIT_X_HANDLE = "create:wait_x_handle";
const CREATE_WAIT_JSON = "create:wait_json";
const CREATE_WAIT_TG = "create:wait_tg_handle";
const CREATE_CONFIRM = "create:confirm";
const LIST_STAR_WAIT_HANDLE = "list_star:wait_handle";
const LIST_STAR_CONFIRM = "list_star:confirm";

const EDIT_FIELD_AVATAR = "edit_field:avatar";
const EDIT_FIELD_TELEGRAM = "edit_field:telegram";
const EDIT_FIELD_FOLLOWERS = "edit_field:followers_count";
const EDIT_FIELD_STAR = "edit_field:list_star_event_cnt";
const EDIT_FIELD_SUPER = "edit_field:super_credit";

const EDIT_CONFIRM_YES = "edit_confirm:yes";
const EDIT_CONFIRM_NO = "edit_confirm:no";
const CREATE_CONFIRM_YES = "create_confirm:yes";
const CREATE_CONFIRM_NO = "create_confirm:no";
const LIST_STAR_CONFIRM_YES = "list_star_confirm:yes";
const LIST_STAR_CONFIRM_NO = "list_star_confirm:no";
const CREATE_REQUIRED_KEYS = ["name", "handle", "sexual_orientation", "follower", "profile_url", "avatar", "bio"];

const EDIT_FIELD_MAP = {
	[EDIT_FIELD_AVATAR]: { column: "avatar", label: "Avatar image URL" },
	[EDIT_FIELD_TELEGRAM]: { column: "telegram", label: "Telegram handle" },
	[EDIT_FIELD_FOLLOWERS]: { column: "followers_count", fallbackColumn: "follower", label: "X followers count" },
	[EDIT_FIELD_STAR]: { column: "list_star_event_cnt", label: "List star event points" },
	[EDIT_FIELD_SUPER]: { column: "super_credit", label: "Super credit" },
};

const ADMIN_ACTIONS = new Set([ADMIN_VIEW, ADMIN_EDIT, ADMIN_CREATE, ADMIN_DELETE, ADMIN_ADD_LIST_STAR]);
const EDIT_FIELD_ACTIONS = new Set(Object.keys(EDIT_FIELD_MAP));
const FIELD_DESCRIPTIONS = {
	id: "Primary key",
	name: "X display name",
	handle: "X handle",
	bio: "X profile bio",
	profile_url: "X profile link",
	avatar: "Avatar image URL",
	sexual_orientation: "Sexual orientation",
	follower: "X followers count",
	followers_count: "X followers count",
	created_at: "Record created time",
	country: "Country",
	city: "City",
	province: "Province",
	telegram: "Telegram handle",
	tg_user_id: "Telegram user ID",
	tg_msg_cnt: "Telegram message count",
	tg_photo_cnt: "Telegram photo count",
	tg_video_cnt: "Telegram video count",
	list_star_event_cnt: "List star event points",
	total_credit: "Total credit",
	super_credit: "Super credit",
	rank: "User rank",
};
const FIELD_EMOJIS = {
	id: "🆔",
	name: "👤",
	handle: "🏷️",
	bio: "📝",
	profile_url: "🔗",
	avatar: "🖼️",
	sexual_orientation: "🌈",
	follower: "👥",
	followers_count: "👥",
	created_at: "📅",
	country: "🌍",
	city: "🏙️",
	province: "🗺️",
	telegram: "📨",
	tg_user_id: "🆔",
	tg_msg_cnt: "💬",
	tg_photo_cnt: "🖼️",
	tg_video_cnt: "🎬",
	list_star_event_cnt: "⭐",
	total_credit: "💰",
	super_credit: "💎",
	rank: "🏆",
};
const PROFILE_SECTIONS = [
	{
		title: "👤 Basic",
		fields: ["id", "name", "handle", "bio", "sexual_orientation", "created_at", "country", "province", "city", "rank"],
	},
	{
		title: "🌐 Links",
		fields: ["profile_url", "avatar", "telegram"],
	},
	{
		title: "📊 Stats",
		fields: [
			"followers_count",
			"follower",
			"tg_user_id",
			"tg_msg_cnt",
			"tg_photo_cnt",
			"tg_video_cnt",
			"list_star_event_cnt",
			"total_credit",
			"super_credit",
		],
	},
];

let sessionSchemaPromise;
let webhookLogSchemaPromise;

function getBotToken(env) {
	const token = String(env.TG_BOT_TOKEN || env.CREDIT_TG_BOT_TOKEN || "").trim();
	if (!token) {
		throw new Error("Missing TG_BOT_TOKEN/CREDIT_TG_BOT_TOKEN in Worker env");
	}
	return token;
}

function getProfilesTable(env) {
	const table = String(env.PROFILE_TABLE || "profiles").trim();
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
		throw new Error("Invalid PROFILE_TABLE");
	}
	return table;
}

const ADMIN_CONSOLE_COOKIE = "admin_console_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

function getAdminConsolePassword(env) {
	return String(env.ADMIN_CONSOLE_PWD || "").trim();
}

function getAdminConsoleSecret(env) {
	return String(env.ADMIN_CONSOLE_SECRET || env.ADMIN_CONSOLE_PWD || "").trim();
}

function timingSafeEqual(a, b) {
	if (a.length !== b.length) return false;
	let out = 0;
	for (let i = 0; i < a.length; i += 1) {
		out |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return out === 0;
}

function bytesToBase64Url(bytes) {
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signHmac(secret, message) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return bytesToBase64Url(new Uint8Array(sigBuffer));
}

function parseCookies(cookieHeader) {
	const out = {};
	for (const part of String(cookieHeader || "").split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (!key) continue;
		out[key] = value;
	}
	return out;
}

async function createConsoleSessionToken(env) {
	const secret = getAdminConsoleSecret(env);
	if (!secret) {
		throw new Error("Missing ADMIN_CONSOLE_SECRET/ADMIN_CONSOLE_PWD in Worker env");
	}
	const issuedAt = Date.now();
	const nonce = crypto.randomUUID();
	const payload = `${issuedAt}:${nonce}`;
	const sig = await signHmac(secret, payload);
	return `${payload}.${sig}`;
}

async function verifyConsoleSessionToken(env, token) {
	const secret = getAdminConsoleSecret(env);
	if (!secret || !token) return false;
	const raw = String(token);
	const split = raw.lastIndexOf(".");
	if (split <= 0) return false;
	const payload = raw.slice(0, split);
	const signature = raw.slice(split + 1);
	const payloadParts = payload.split(":");
	if (payloadParts.length !== 2) return false;
	const issuedAt = Number.parseInt(payloadParts[0], 10);
	if (!Number.isFinite(issuedAt)) return false;
	const ageMs = Date.now() - issuedAt;
	if (ageMs < 0 || ageMs > ADMIN_SESSION_TTL_SECONDS * 1000) return false;
	const expectedSig = await signHmac(secret, payload);
	return timingSafeEqual(signature, expectedSig);
}

function htmlResponse(html, status = 200, headers = {}) {
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"x-frame-options": "DENY",
			...headers,
		},
	});
}

function jsonResponse(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...headers,
		},
	});
}

function getTwitterApiKey(env) {
	return String(env.TWITTERAPI_IO_KEY || env.TWITTERAPI_KEY || env.X_API_KEY || "").trim();
}

async function callTwitterApi(env, method, path, body) {
	const apiKey = getTwitterApiKey(env);
	if (!apiKey) {
		return { ok: false, status: 500, data: null, error: "Missing TWITTERAPI_IO_KEY/TWITTERAPI_KEY/X_API_KEY in Worker env" };
	}

	const url = new URL(path, "https://api.twitterapi.io");
	const headers = { "X-API-Key": apiKey };
	const options = { method, headers };
	if (body !== undefined) {
		headers["content-type"] = "application/json";
		options.body = JSON.stringify(body);
	}

	let response;
	try {
		response = await fetch(url.toString(), options);
	} catch (err) {
		return { ok: false, status: 502, data: null, error: `Upstream request failed: ${String(err?.message || err)}` };
	}

	const text = await response.text().catch(() => "");
	let payload = null;
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = { raw: text };
		}
	}

	if (!response.ok) {
		return { ok: false, status: response.status, data: payload, error: `Upstream error ${response.status}` };
	}

	if (payload && payload.status === "error") {
		return { ok: false, status: 502, data: payload, error: String(payload.msg || payload.message || "twitterapi.io returned error") };
	}

	return { ok: true, status: response.status, data: payload, error: "" };
}

function truncateText(input, maxLen = 2000) {
	const s = String(input || "");
	if (s.length <= maxLen) return s;
	return `${s.slice(0, maxLen)}...[truncated]`;
}

async function ensureWebhookLogSchema(env) {
	if (!env.DB) {
		throw new Error("Missing D1 binding: DB");
	}
	if (!webhookLogSchemaPromise) {
		webhookLogSchemaPromise = env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS admin_webhook_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), method TEXT NOT NULL, path TEXT NOT NULL, query TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', headers_json TEXT NOT NULL DEFAULT '{}', body_text TEXT NOT NULL DEFAULT '')"
		).run();
	}
	await webhookLogSchemaPromise;
}

async function logWebhookAccess(env, request, url) {
	await ensureWebhookLogSchema(env);
	const headersObj = {};
	for (const [k, v] of request.headers.entries()) {
		headersObj[k] = v;
	}
	const ip =
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-forwarded-for") ||
		request.headers.get("x-real-ip") ||
		"";
	const userAgent = request.headers.get("user-agent") || "";
	const bodyText = truncateText(await request.text().catch(() => ""), 4000);
	await env.DB.prepare(
		"INSERT INTO admin_webhook_logs (method, path, query, ip, user_agent, headers_json, body_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
	)
		.bind(
			String(request.method || ""),
			String(url.pathname || ""),
			String(url.search || ""),
			String(ip),
			String(userAgent),
			JSON.stringify(headersObj),
			bodyText
		)
		.run();
}

async function listWebhookLogs(env, limit = 100) {
	await ensureWebhookLogSchema(env);
	const n = Math.max(1, Math.min(300, Number.parseInt(String(limit || 100), 10) || 100));
	const result = await env.DB.prepare(
		"SELECT id, created_at, method, path, query, ip, user_agent, headers_json, body_text FROM admin_webhook_logs ORDER BY id DESC LIMIT ?"
	)
		.bind(n)
		.all();
	return Array.isArray(result?.results) ? result.results : [];
}

async function clearWebhookLogs(env) {
	await ensureWebhookLogSchema(env);
	await env.DB.prepare("DELETE FROM admin_webhook_logs").run();
}

function renderLoginPage(errorMsg = "") {
	const errorBlock = errorMsg ? `<p class="err">${escapeHtml(errorMsg)}</p>` : "";
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Console Login</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top, #0d2335 0%, #05070c 58%, #020307 100%);
      color: #dbeafe;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .card {
      width: min(420px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid rgba(34, 211, 238, 0.28);
      border-radius: 18px;
      background: rgba(5, 15, 28, 0.76);
      box-shadow: 0 20px 80px rgba(2, 132, 199, 0.25);
    }
    h1 { margin: 0 0 10px; font-size: 24px; color: #67e8f9; }
    p { margin: 0 0 12px; color: #93c5fd; font-size: 14px; }
    .err { color: #fca5a5; margin-bottom: 14px; }
    input {
      width: 100%;
      box-sizing: border-box;
      height: 42px;
      border-radius: 10px;
      border: 1px solid #1d4ed8;
      background: #0b1222;
      color: #e2e8f0;
      padding: 0 12px;
      font-size: 15px;
      outline: none;
    }
    input:focus { border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.2); }
    button {
      margin-top: 12px;
      width: 100%;
      height: 42px;
      border: 0;
      border-radius: 10px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      color: #00131f;
      background: linear-gradient(135deg, #22d3ee 0%, #38bdf8 55%, #60a5fa 100%);
    }
  </style>
</head>
<body>
  <form class="card" method="post" action="/admin/login">
    <h1>Admin Console</h1>
    <p>请输入控制台密码</p>
    ${errorBlock}
    <input type="password" name="password" autocomplete="current-password" required />
    <button type="submit">登录</button>
  </form>
</body>
</html>`;
}

function renderConsolePage() {
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Console</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 8%, rgba(34, 211, 238, 0.18) 0%, rgba(34, 211, 238, 0) 42%),
        radial-gradient(circle at 82% 20%, rgba(59, 130, 246, 0.22) 0%, rgba(59, 130, 246, 0) 45%),
        #071022;
      color: #e2e8f0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .wrap {
      width: min(1160px, calc(100vw - 32px));
      margin: 28px auto 40px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0;
      font-size: 46px;
      letter-spacing: -0.5px;
      color: #e2e8f0;
      font-weight: 800;
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .btn {
      height: 42px;
      border: 0;
      border-radius: 10px;
      cursor: pointer;
      padding: 0 16px;
      color: #e5f3ff;
      background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
      font-weight: 700;
      font-size: 14px;
      white-space: nowrap;
    }
    .btn.green {
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    }
    .btn.ghost {
      border: 1px solid rgba(248, 113, 113, 0.6);
      background: rgba(127, 29, 29, 0.15);
      color: #fca5a5;
    }
    .panel {
      border: 1px solid rgba(59, 130, 246, 0.26);
      background: rgba(15, 23, 42, 0.86);
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 16px;
      box-shadow: 0 20px 70px rgba(2, 132, 199, 0.16);
    }
    .head-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(280px, 1fr));
      gap: 16px;
    }
    .metric-card {
      display: flex;
      align-items: center;
      gap: 16px;
      min-height: 170px;
    }
    .metric-title {
      font-size: 15px;
      color: #7dd3fc;
      margin: 0 0 4px;
    }
    .metric-num {
      font-size: 33px;
      font-weight: 800;
      margin: 0;
      color: #f8fafc;
      line-height: 1.1;
      word-break: break-all;
    }
    .metric-sub {
      font-size: 13px;
      color: #93c5fd;
      margin-top: 8px;
      word-break: break-all;
    }
    .ring {
      --pct: 0;
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background:
        radial-gradient(circle at center, #0f172a 56%, transparent 57%),
        conic-gradient(#22d3ee calc(var(--pct) * 1%), rgba(148, 163, 184, 0.25) 0);
      border: 1px solid rgba(125, 211, 252, 0.3);
      flex: 0 0 auto;
      display: grid;
      place-items: center;
    }
    .ring span {
      font-size: 13px;
      color: #dbeafe;
      font-weight: 700;
    }
    .section-title {
      margin: 0 0 10px;
      color: #34d399;
      font-size: 21px;
      font-weight: 700;
    }
    .muted {
      color: #94a3b8;
      font-size: 12px;
      margin: 0 0 10px;
    }
    .msg {
      min-height: 20px;
      font-size: 14px;
      color: #93c5fd;
      white-space: pre-wrap;
    }
    .msg.err { color: #fca5a5; }
    .mgr-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .mgr-toggle p {
      margin: 0;
      color: #a5b4fc;
      font-size: 14px;
    }
    .mgr-content[hidden] { display: none; }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(280px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .sub {
      border: 1px solid rgba(125, 211, 252, 0.18);
      border-radius: 12px;
      padding: 12px;
      background: rgba(2, 6, 23, 0.55);
    }
    .sub h3 {
      margin: 0 0 8px;
      font-size: 16px;
      color: #c7d2fe;
    }
    label {
      display: block;
      margin: 8px 0 6px;
      color: #7dd3fc;
      font-size: 13px;
    }
    input[type="text"], input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      height: 40px;
      border-radius: 10px;
      border: 1px solid #0f766e;
      background: #04111f;
      color: #e2e8f0;
      padding: 0 12px;
    }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .btn.sm {
      height: 36px;
      font-size: 13px;
      padding: 0 12px;
    }
    .btn.dark {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border: 1px solid #334155;
      color: #dbeafe;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
      word-break: break-all;
    }
    th { color: #7dd3fc; }
    pre {
      margin: 8px 0 0;
      background: rgba(2, 6, 23, 0.75);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 10px;
      overflow: auto;
      font-size: 12px;
      max-height: 260px;
    }
    code {
      color: #bfdbfe;
      background: rgba(30, 41, 59, 0.7);
      padding: 2px 6px;
      border-radius: 6px;
    }
    @media (max-width: 980px) {
      h1 { font-size: 34px; }
      .head-grid, .grid-2 { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
      .actions { width: 100%; }
      .actions .btn { flex: 1; }
    }
    @media (max-width: 520px) {
      .metric-card { flex-direction: column; align-items: flex-start; }
      .ring { width: 102px; height: 102px; }
      .metric-num { font-size: 28px; }
    }
    form.inline { margin: 0; }
    .link-box {
      font-size: 13px;
      color: #bfdbfe;
      word-break: break-all;
      margin: 0;
    }
    .pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(34, 197, 94, 0.16);
      color: #86efac;
    }
    .k-title {
      margin: 0 0 8px;
      font-size: 14px;
      color: #7dd3fc;
    }
    .small-table-wrap {
      overflow: auto;
      max-height: 360px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
    }
    .small-table-wrap table { margin-top: 0; }
    .log-body {
      max-width: 360px;
      white-space: pre-wrap;
      font-size: 12px;
      color: #cbd5e1;
    }
    .nowrap { white-space: nowrap; }
    .h-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .h-actions .left { font-size: 13px; color: #bfdbfe; }
    .h-actions .right { display: flex; gap: 8px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .copy-btn {
      border: 1px solid rgba(125, 211, 252, 0.5);
      background: rgba(15, 23, 42, 0.8);
      color: #dbeafe;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <h1>Dashboard</h1>
      <div class="actions">
        <button id="refreshBalance" class="btn">Refresh Balance</button>
        <form method="post" action="/admin/logout" class="inline"><button class="btn ghost" type="submit">退出登录</button></form>
        <a href="/admin/docs" target="_blank" rel="noopener noreferrer" class="btn dark" style="text-decoration:none;display:inline-flex;align-items:center;">文档</a>
      </div>
    </div>

    <section class="panel">
      <div class="head-grid">
        <div class="metric-card">
          <div id="ringRemaining" class="ring" style="--pct:0"><span id="remainingPct">0%</span></div>
          <div>
            <p class="metric-title">剩余余额 / Remaining Credits</p>
            <p id="remainingValue" class="metric-num">-</p>
            <div id="balanceHint" class="metric-sub">等待刷新</div>
          </div>
        </div>
        <div class="metric-card">
          <div id="ringTotal" class="ring" style="--pct:0"><span id="totalPct">0%</span></div>
          <div>
            <p class="metric-title">总余额 / Total Credits</p>
            <p id="totalValue" class="metric-num">-</p>
            <div id="usedValue" class="metric-sub">已使用: -</div>
          </div>
        </div>
      </div>
      <p class="muted">余额来源: <code>GET /oapi/my/info</code></p>
      <div id="balanceMsg" class="msg"></div>
      <pre id="balanceRaw">{}</pre>
    </section>

    <section class="panel">
      <div class="mgr-toggle">
        <div>
          <h2 class="section-title">Webhook 管理</h2>
          <p>点击按钮展开增删改查面板和 Cloudflare webhook 监视面板。</p>
        </div>
        <button id="toggleManager" class="btn green">进入 Webhook 管理</button>
      </div>
    </section>

    <section id="managerSection" class="panel mgr-content" hidden>
      <div class="h-actions">
        <div class="left">Tweet Filter Rule 增删改查 + 本 Worker 的 webhook 监视</div>
        <div class="right">
          <button id="refreshRules" class="btn sm">获取规则</button>
          <button id="refreshLogs" class="btn sm dark">刷新访问日志</button>
        </div>
      </div>

      <div class="sub">
        <h3>查询规则（Get All）</h3>
        <div class="small-table-wrap">
          <table>
            <thead>
              <tr>
                <th>rule_id</th>
                <th>tag</th>
                <th>value</th>
                <th>interval</th>
                <th>is_effect</th>
              </tr>
            </thead>
            <tbody id="rulesTableBody"><tr><td colspan="5" class="muted">暂无数据</td></tr></tbody>
          </table>
        </div>
        <div id="ruleMsg" class="msg"></div>
      </div>

      <div class="grid-2">
        <div class="sub">
          <h3>新增规则（Add）</h3>
          <label>tag</label><input id="addTag" type="text" placeholder="myhook" />
          <label>value</label><input id="addValue" type="text" placeholder="from:elonmusk" />
          <label>webhook_url</label><input id="addWebhookUrl" type="text" placeholder="https://your-domain/cf-webhook" />
          <label>interval_seconds</label><input id="addInterval" type="number" min="0.1" step="0.1" value="300" />
          <div class="row"><button id="addRuleBtn" class="btn sm green" type="button">添加规则</button></div>
        </div>
        <div class="sub">
          <h3>更新规则（Update）</h3>
          <label>rule_id</label><input id="updRuleId" type="text" placeholder="输入要更新的 rule_id" />
          <label>tag</label><input id="updTag" type="text" placeholder="updated-tag" />
          <label>value</label><input id="updValue" type="text" placeholder="keyword OR from:xxx" />
          <label>webhook_url</label><input id="updWebhookUrl" type="text" placeholder="https://your-domain/cf-webhook" />
          <label>interval_seconds</label><input id="updInterval" type="number" min="0.1" step="0.1" value="300" />
          <label>is_effect (1=启用, 0=禁用)</label><input id="updEffect" type="number" min="0" max="1" step="1" value="1" />
          <div class="row"><button id="updRuleBtn" class="btn sm dark" type="button">更新规则</button></div>
        </div>
        <div class="sub">
          <h3>删除规则（Delete）</h3>
          <label>rule_id</label><input id="delRuleId" type="text" placeholder="输入要删除的 rule_id" />
          <div class="row"><button id="delRuleBtn" class="btn sm dark" type="button">删除规则</button></div>
        </div>
        <div class="sub">
          <h3>监视 Cloudflare Webhook</h3>
          <p class="k-title">Webhook URL</p>
          <p id="webhookUrl" class="link-box mono"></p>
          <div class="row">
            <button id="copyWebhookBtn" class="copy-btn" type="button">复制 URL</button>
            <span class="pill">访问即记录</span>
          </div>
          <div class="row">
            <button id="clearLogsBtn" class="btn sm dark" type="button">清空监视日志</button>
          </div>
          <div id="logMsg" class="msg"></div>
        </div>
      </div>

      <div class="sub" style="margin-top: 12px;">
        <h3>访问记录</h3>
        <div class="small-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="nowrap">time</th>
                <th>method</th>
                <th>path</th>
                <th>query</th>
                <th>ip</th>
                <th>ua</th>
                <th>body</th>
              </tr>
            </thead>
            <tbody id="logsTableBody"><tr><td colspan="7" class="muted">暂无 webhook 访问记录</td></tr></tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
  <script>
    const balanceMsg = document.getElementById("balanceMsg");
    const ruleMsg = document.getElementById("ruleMsg");
    const logMsg = document.getElementById("logMsg");
    const managerSection = document.getElementById("managerSection");
    const toggleManagerBtn = document.getElementById("toggleManager");
    const remainingValue = document.getElementById("remainingValue");
    const totalValue = document.getElementById("totalValue");
    const usedValue = document.getElementById("usedValue");
    const remainingPct = document.getElementById("remainingPct");
    const totalPct = document.getElementById("totalPct");
    const balanceHint = document.getElementById("balanceHint");
    const ringRemaining = document.getElementById("ringRemaining");
    const ringTotal = document.getElementById("ringTotal");
    const balanceRaw = document.getElementById("balanceRaw");
    const rulesBody = document.getElementById("rulesTableBody");
    const logsBody = document.getElementById("logsTableBody");
    const webhookUrlEl = document.getElementById("webhookUrl");

    function setMsg(el, text, isError = false) {
      el.textContent = text || "";
      el.className = isError ? "msg err" : "msg";
    }

    async function api(path, options) {
      const res = await fetch(path, options || {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || ("HTTP " + res.status));
      }
      return data;
    }

    function numOrDash(v) {
      if (v === null || v === undefined || v === "") return "-";
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : String(v);
    }

    function toNum(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function pct(remaining, total) {
      if (total <= 0) return 0;
      return Math.max(0, Math.min(100, (remaining / total) * 100));
    }

    async function refreshBalance() {
      setMsg(balanceMsg, "加载余额中...");
      try {
        const res = await api("/admin/api/balance");
        const d = res.data || {};

        const nRecharge = toNum(d.recharge_credits);
        const nBonus = toNum(d.total_bonus_credits ?? d.bonus_credits ?? d.remaining_bonus_credits);
        const nDirectRemaining = toNum(d.remaining_credits ?? d.balance ?? d.credits);
        let nRem = nDirectRemaining;
        if (nRem === null && (nRecharge !== null || nBonus !== null)) {
          nRem = (nRecharge || 0) + (nBonus || 0);
        }

        let total = d.total_credits ?? d.all_credits ?? d.granted_credits ?? null;
        let used = d.used_credits ?? d.total_used_credits ?? null;
        const nUsedRecharge = toNum(d.used_recharge_credits);
        const nUsedBonus = toNum(d.used_bonus_credits);
        if (used === null && (nUsedRecharge !== null || nUsedBonus !== null)) {
          used = (nUsedRecharge || 0) + (nUsedBonus || 0);
        }

        if (total === null && nRem !== null && used !== null) {
          const nUsed = toNum(used);
          if (nUsed !== null) total = nRem + nUsed;
        }
        if (total === null && nRem !== null) {
          total = nRem;
        }

        const nTotal = toNum(total);
        if (used === null && nTotal !== null && nRem !== null) {
          used = nTotal - nRem;
        }
        const nUsed = toNum(used);
        const p = nRem !== null && nTotal !== null ? pct(nRem, nTotal) : (nRem && nRem > 0 ? 100 : 0);
        const pTotal = nTotal !== null && nTotal > 0 ? 100 : 0;

        remainingValue.textContent = numOrDash(nRem);
        totalValue.textContent = numOrDash(total);
        usedValue.textContent = numOrDash(used);
        remainingPct.textContent = Math.round(p) + "%";
        totalPct.textContent = Math.round(pTotal) + "%";
        ringRemaining.style.setProperty("--pct", String(p));
        ringTotal.style.setProperty("--pct", String(pTotal));
        balanceHint.textContent = nUsed !== null ? ("已使用: " + numOrDash(used)) : "已使用: -";
        balanceRaw.textContent = JSON.stringify(d, null, 2);
        setMsg(balanceMsg, "余额已更新");
      } catch (err) {
        setMsg(balanceMsg, err.message || "余额查询失败", true);
      }
    }

    function renderRules(list) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.length === 0) {
        rulesBody.innerHTML = '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
        return;
      }
      const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      rulesBody.innerHTML = arr.map((r) => {
        const id = r.rule_id ?? r.id ?? "";
        const tag = r.tag ?? "";
        const value = r.value ?? "";
        const interval = r.interval_seconds ?? "";
        const effect = r.is_effect ?? "";
        return '<tr>' +
          '<td>' + esc(id) + '</td>' +
          '<td>' + esc(tag) + '</td>' +
          '<td>' + esc(value) + '</td>' +
          '<td>' + esc(interval) + '</td>' +
          '<td>' + esc(effect) + '</td>' +
          '</tr>';
      }).join("");
    }

    async function refreshRules() {
      setMsg(ruleMsg, "获取规则中...");
      try {
        const res = await api("/admin/api/rules");
        const list = res.rules || res.data || [];
        renderRules(list);
        setMsg(ruleMsg, "规则已更新");
      } catch (err) {
        setMsg(ruleMsg, err.message || "获取规则失败", true);
      }
    }

    function esc(v) {
      return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    async function refreshWebhookLogs() {
      setMsg(logMsg, "加载 webhook 访问日志...");
      try {
        const res = await api("/admin/api/webhook/logs?limit=120");
        const rows = Array.isArray(res.logs) ? res.logs : [];
        if (rows.length === 0) {
          logsBody.innerHTML = '<tr><td colspan="7" class="muted">暂无 webhook 访问记录</td></tr>';
        } else {
          logsBody.innerHTML = rows.map((r) => {
            return '<tr>' +
              '<td class="nowrap">' + esc(r.created_at || "") + '</td>' +
              '<td>' + esc(r.method || "") + '</td>' +
              '<td>' + esc(r.path || "") + '</td>' +
              '<td>' + esc(r.query || "") + '</td>' +
              '<td>' + esc(r.ip || "") + '</td>' +
              '<td>' + esc(r.user_agent || "") + '</td>' +
              '<td><div class="log-body">' + esc(r.body_text || "") + '</div></td>' +
              '</tr>';
          }).join("");
        }
        setMsg(logMsg, "日志已更新");
      } catch (err) {
        setMsg(logMsg, err.message || "日志获取失败", true);
      }
    }

    document.getElementById("refreshBalance").addEventListener("click", refreshBalance);
    document.getElementById("refreshRules").addEventListener("click", refreshRules);
    document.getElementById("refreshLogs").addEventListener("click", refreshWebhookLogs);

    document.getElementById("addRuleBtn").addEventListener("click", async () => {
      const tag = document.getElementById("addTag").value.trim();
      const value = document.getElementById("addValue").value.trim();
      const webhookUrl = document.getElementById("addWebhookUrl").value.trim();
      const interval = Number(document.getElementById("addInterval").value);
      if (!tag || !value || !webhookUrl || !Number.isFinite(interval) || interval <= 0) {
        setMsg(ruleMsg, "新增参数不完整", true);
        return;
      }
      setMsg(ruleMsg, "添加中...");
      try {
        await api("/admin/api/rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag, value, webhook_url: webhookUrl, interval_seconds: interval }),
        });
        setMsg(ruleMsg, "添加成功");
        await refreshRules();
      } catch (err) {
        setMsg(ruleMsg, err.message || "添加失败", true);
      }
    });

    document.getElementById("updRuleBtn").addEventListener("click", async () => {
      const ruleId = document.getElementById("updRuleId").value.trim();
      const tag = document.getElementById("updTag").value.trim();
      const value = document.getElementById("updValue").value.trim();
      const webhookUrl = document.getElementById("updWebhookUrl").value.trim();
      const interval = Number(document.getElementById("updInterval").value);
      const effect = Number(document.getElementById("updEffect").value);
      if (!ruleId || !tag || !value || !webhookUrl || !Number.isFinite(interval) || interval <= 0 || (effect !== 0 && effect !== 1)) {
        setMsg(ruleMsg, "更新参数不完整", true);
        return;
      }
      setMsg(ruleMsg, "更新中...");
      try {
        await api("/admin/api/rules/" + encodeURIComponent(ruleId), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag, value, webhook_url: webhookUrl, interval_seconds: interval, is_effect: effect }),
        });
        setMsg(ruleMsg, "更新成功");
        await refreshRules();
      } catch (err) {
        setMsg(ruleMsg, err.message || "更新失败", true);
      }
    });

    document.getElementById("delRuleBtn").addEventListener("click", async () => {
      const ruleId = document.getElementById("delRuleId").value.trim();
      if (!ruleId) {
        setMsg(ruleMsg, "请填写要删除的 rule_id", true);
        return;
      }
      setMsg(ruleMsg, "删除中...");
      try {
        await api("/admin/api/rules/" + encodeURIComponent(ruleId), { method: "DELETE" });
        setMsg(ruleMsg, "删除成功");
        await refreshRules();
      } catch (err) {
        setMsg(ruleMsg, err.message || "删除失败", true);
      }
    });

    document.getElementById("clearLogsBtn").addEventListener("click", async () => {
      setMsg(logMsg, "清空中...");
      try {
        await api("/admin/api/webhook/logs", { method: "DELETE" });
        setMsg(logMsg, "已清空");
        await refreshWebhookLogs();
      } catch (err) {
        setMsg(logMsg, err.message || "清空失败", true);
      }
    });

    toggleManagerBtn.addEventListener("click", async () => {
      const willOpen = managerSection.hidden;
      managerSection.hidden = !willOpen ? true : false;
      toggleManagerBtn.textContent = willOpen ? "收起 Webhook 管理" : "进入 Webhook 管理";
      if (willOpen) {
        await refreshRules();
        await refreshWebhookLogs();
      }
    });

    const webhookUrl = location.origin + "/cf-webhook";
    webhookUrlEl.textContent = webhookUrl;
    const addWebhookInput = document.getElementById("addWebhookUrl");
    const updWebhookInput = document.getElementById("updWebhookUrl");
    if (addWebhookInput) addWebhookInput.value = webhookUrl;
    if (updWebhookInput) updWebhookInput.value = webhookUrl;
    document.getElementById("copyWebhookBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl);
        setMsg(logMsg, "Webhook URL 已复制");
      } catch {
        setMsg(logMsg, "复制失败，请手动复制", true);
      }
    });

    refreshBalance();
  </script>
</body>
</html>`;
}

function renderDocsPage() {
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Webhook Rules Docs</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 14% 8%, rgba(34, 211, 238, 0.16) 0%, rgba(34, 211, 238, 0) 44%),
        radial-gradient(circle at 88% 18%, rgba(59, 130, 246, 0.20) 0%, rgba(59, 130, 246, 0) 46%),
        #071022;
      color: #e2e8f0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .wrap { width: min(980px, calc(100vw - 28px)); margin: 24px auto 36px; }
    .top {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    h1 { margin: 0; font-size: 32px; color: #e2e8f0; }
    .btn {
      border-radius: 10px;
      border: 1px solid rgba(125, 211, 252, 0.42);
      color: #dbeafe;
      background: rgba(15, 23, 42, 0.85);
      text-decoration: none;
      padding: 10px 14px;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
    }
    .panel {
      border: 1px solid rgba(59, 130, 246, 0.26);
      background: rgba(15, 23, 42, 0.86);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 14px;
    }
    h2 { margin: 0 0 10px; font-size: 20px; color: #34d399; }
    .muted { color: #93c5fd; font-size: 13px; margin: 0 0 10px; }
    pre {
      margin: 8px 0 0;
      background: rgba(2, 6, 23, 0.75);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 10px;
      overflow: auto;
      font-size: 13px;
      color: #e2e8f0;
    }
    code {
      color: #bfdbfe;
      background: rgba(30, 41, 59, 0.7);
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>规则文档</h1>
      <a class="btn" href="/admin">返回控制台</a>
    </div>

    <section class="panel">
      <h2>目标</h2>
      <p class="muted">任何人评论（回复）你的帖子时，触发你的 webhook（你配置的 twitterapi.io webhook，指向本 Worker 的 <code>/cf-webhook</code>）。</p>
      <p class="muted">把下面示例里的 <code>your_x_username</code> 替换成你的 X 用户名（不带 @）。</p>
      <p class="muted">官方 webhook 控制台: <a href="https://twitterapi.io/tweet-filter-rules" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;">https://twitterapi.io/tweet-filter-rules</a></p>
    </section>

    <section class="panel">
      <h2>新增规则示例（Add）</h2>
      <pre>{
  "tag": "reply_to_me",
  "value": "to:your_x_username is:reply -from:your_x_username",
  "webhook_url": "https://your-domain/cf-webhook",
  "interval_seconds": 300
}</pre>
      <p class="muted">如果 <code>is:reply</code> 在你的数据源下不稳定，可改为：</p>
      <pre>{
  "tag": "reply_to_me_fallback",
  "value": "to:your_x_username -from:your_x_username",
  "webhook_url": "https://your-domain/cf-webhook",
  "interval_seconds": 300
}</pre>
    </section>

    <section class="panel">
      <h2>更新规则示例（Update）</h2>
      <pre>{
  "rule_id": "你的规则ID",
  "tag": "reply_to_me_v2",
  "value": "to:your_x_username is:reply -from:your_x_username",
  "webhook_url": "https://your-domain/cf-webhook",
  "interval_seconds": 300,
  "is_effect": 1
}</pre>
    </section>

    <section class="panel">
      <h2>面板字段对应</h2>
      <pre>新增规则:
tag               -> reply_to_me
value             -> to:your_x_username is:reply -from:your_x_username
webhook_url       -> https://your-domain/cf-webhook
interval_seconds  -> 300

更新规则:
rule_id           -> 你的规则ID
tag               -> reply_to_me_v2
value             -> to:your_x_username is:reply -from:your_x_username
webhook_url       -> https://your-domain/cf-webhook
interval_seconds  -> 300
is_effect         -> 1
</pre>
    </section>
  </div>
</body>
</html>`;
}

function isJsonRequest(request) {
	return String(request.headers.get("content-type") || "").toLowerCase().includes("application/json");
}

async function parsePasswordFromRequest(request) {
	if (isJsonRequest(request)) {
		const body = await request.json().catch(() => null);
		return String(body?.password || "").trim();
	}
	const form = await request.formData().catch(() => null);
	return String(form?.get("password") || "").trim();
}

async function isAdminConsoleAuthed(request, env) {
	const cookieMap = parseCookies(request.headers.get("cookie") || "");
	const token = cookieMap[ADMIN_CONSOLE_COOKIE];
	return verifyConsoleSessionToken(env, token);
}

function buildSessionCookie(token, maxAge) {
	return `${ADMIN_CONSOLE_COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function handleAdminConsole(request, env, url) {
	const pathname = url.pathname;

	if (pathname === "/admin" && request.method === "GET") {
		const authed = await isAdminConsoleAuthed(request, env);
		return authed ? htmlResponse(renderConsolePage()) : htmlResponse(renderLoginPage());
	}

	if (pathname === "/admin/docs" && request.method === "GET") {
		const authed = await isAdminConsoleAuthed(request, env);
		return authed ? htmlResponse(renderDocsPage()) : htmlResponse(renderLoginPage());
	}

	if (pathname === "/admin/login" && request.method === "POST") {
		const expectedPwd = getAdminConsolePassword(env);
		if (!expectedPwd) {
			return htmlResponse(renderLoginPage("服务端未配置 ADMIN_CONSOLE_PWD"), 500);
		}
		const inputPwd = await parsePasswordFromRequest(request);
		if (!timingSafeEqual(inputPwd, expectedPwd)) {
			return htmlResponse(renderLoginPage("密码错误，请重试"), 401);
		}
		const token = await createConsoleSessionToken(env);
		return new Response(null, {
			status: 302,
			headers: {
				location: "/admin",
				"set-cookie": buildSessionCookie(token, ADMIN_SESSION_TTL_SECONDS),
				"cache-control": "no-store",
			},
		});
	}

	if (pathname === "/admin/logout" && request.method === "POST") {
		return new Response(null, {
			status: 302,
			headers: {
				location: "/admin",
				"set-cookie": buildSessionCookie("", 0),
				"cache-control": "no-store",
			},
		});
	}

	if (pathname.startsWith("/admin/api/")) {
		const authed = await isAdminConsoleAuthed(request, env);
		if (!authed) {
			return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
		}

		if (pathname === "/admin/api/webhook/logs" && request.method === "GET") {
			const limit = new URL(request.url).searchParams.get("limit");
			const logs = await listWebhookLogs(env, limit);
			return jsonResponse({ ok: true, logs });
		}

		if (pathname === "/admin/api/webhook/logs" && request.method === "DELETE") {
			await clearWebhookLogs(env);
			return jsonResponse({ ok: true });
		}

		if (pathname === "/admin/api/balance" && request.method === "GET") {
			const upstream = await callTwitterApi(env, "GET", "/oapi/my/info");
			if (!upstream.ok) {
				return jsonResponse(
					{
						ok: false,
						error: upstream.error,
						upstream_status: upstream.status,
						data: upstream.data,
					},
					500
				);
			}
			return jsonResponse({ ok: true, data: upstream.data });
		}

		if (pathname === "/admin/api/rules" && request.method === "GET") {
			const upstream = await callTwitterApi(env, "GET", "/oapi/tweet_filter/get_rules");
			if (!upstream.ok) {
				return jsonResponse(
					{
						ok: false,
						error: upstream.error,
						upstream_status: upstream.status,
						data: upstream.data,
					},
					500
				);
			}
			const rules = Array.isArray(upstream.data?.rules) ? upstream.data.rules : [];
			return jsonResponse({ ok: true, rules, data: upstream.data });
		}

		if (pathname === "/admin/api/rules" && request.method === "POST") {
			const body = await request.json().catch(() => null);
			const tag = String(body?.tag || "").trim();
			const value = String(body?.value || "").trim();
			const webhookUrl = String(body?.webhook_url || "").trim();
			const intervalSeconds = Number(body?.interval_seconds);
			if (!tag || !value || !webhookUrl || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
				return jsonResponse({ ok: false, error: "Invalid body: require tag, value, webhook_url, interval_seconds>0" }, 400);
			}
			try {
				const parsed = new URL(webhookUrl);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					return jsonResponse({ ok: false, error: "Invalid webhook_url protocol" }, 400);
				}
			} catch {
				return jsonResponse({ ok: false, error: "Invalid webhook_url format" }, 400);
			}
			const upstream = await callTwitterApi(env, "POST", "/oapi/tweet_filter/add_rule", {
				tag,
				value,
				webhook_url: webhookUrl,
				interval_seconds: intervalSeconds,
			});
			if (!upstream.ok) {
				return jsonResponse(
					{
						ok: false,
						error: upstream.error,
						upstream_status: upstream.status,
						data: upstream.data,
					},
					500
				);
			}
			return jsonResponse({ ok: true, data: upstream.data });
		}

		const ruleMatch = pathname.match(/^\/admin\/api\/rules\/([^/]+)$/);
		if (ruleMatch && request.method === "PUT") {
			const ruleId = decodeURIComponent(ruleMatch[1]);
			const body = await request.json().catch(() => null);
			const tag = String(body?.tag || "").trim();
			const value = String(body?.value || "").trim();
			const webhookUrl = String(body?.webhook_url || "").trim();
			const intervalSeconds = Number(body?.interval_seconds);
			const isEffect = Number(body?.is_effect);
			if (!ruleId || !tag || !value || !webhookUrl || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0 || (isEffect !== 0 && isEffect !== 1)) {
				return jsonResponse({ ok: false, error: "Invalid body: require tag,value,webhook_url,interval_seconds>0,is_effect(0|1)" }, 400);
			}
			try {
				const parsed = new URL(webhookUrl);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					return jsonResponse({ ok: false, error: "Invalid webhook_url protocol" }, 400);
				}
			} catch {
				return jsonResponse({ ok: false, error: "Invalid webhook_url format" }, 400);
			}
			const upstream = await callTwitterApi(env, "POST", "/oapi/tweet_filter/update_rule", {
				rule_id: ruleId,
				tag,
				value,
				webhook_url: webhookUrl,
				interval_seconds: intervalSeconds,
				is_effect: isEffect,
			});
			if (!upstream.ok) {
				return jsonResponse(
					{
						ok: false,
						error: upstream.error,
						upstream_status: upstream.status,
						data: upstream.data,
					},
					500
				);
			}
			return jsonResponse({ ok: true, data: upstream.data });
		}

		if (ruleMatch && request.method === "DELETE") {
			const ruleId = decodeURIComponent(ruleMatch[1]);
			if (!ruleId) {
				return jsonResponse({ ok: false, error: "rule_id is required" }, 400);
			}

			const attempts = [];
			const try1 = await callTwitterApi(env, "POST", "/oapi/tweet_filter/delete_rule", { rule_id: ruleId });
			attempts.push({ name: "POST rule_id", ok: try1.ok, status: try1.status, data: try1.data, error: try1.error });
			if (try1.ok) {
				return jsonResponse({ ok: true, data: try1.data });
			}

			const try2 = await callTwitterApi(env, "POST", "/oapi/tweet_filter/delete_rule", { id: ruleId });
			attempts.push({ name: "POST id", ok: try2.ok, status: try2.status, data: try2.data, error: try2.error });
			if (try2.ok) {
				return jsonResponse({ ok: true, data: try2.data });
			}

			const try3 = await callTwitterApi(env, "DELETE", "/oapi/tweet_filter/delete_rule", { rule_id: ruleId });
			attempts.push({ name: "DELETE rule_id", ok: try3.ok, status: try3.status, data: try3.data, error: try3.error });
			if (try3.ok) {
				return jsonResponse({ ok: true, data: try3.data });
			}

			return jsonResponse(
				{
					ok: false,
					error: "Delete rule failed in all request variants",
					attempts,
				},
				502
			);
		}

		return jsonResponse({ ok: false, error: "Not found" }, 404);
	}

	return new Response("Not found", { status: 404 });
}

async function handleCloudflareWebhook(request, env, url) {
	try {
		await logWebhookAccess(env, request, url);
	} catch (err) {
		console.error("Webhook log write failed:", err);
	}
	return jsonResponse({
		ok: true,
		message: "Webhook received",
		path: url.pathname,
		method: request.method,
		ts: new Date().toISOString(),
	});
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function isAdminCommand(text) {
	if (!text) return false;
	const command = String(text).trim().split(/\s+/)[0].toLowerCase();
	return command === "/admin" || command.startsWith("/admin@");
}

function getAdminKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "🔍 View Info", callback_data: ADMIN_VIEW },
				{ text: "➕ Create Info", callback_data: ADMIN_CREATE },
			],
			[
				{ text: "⭐ Add to List Star", callback_data: ADMIN_ADD_LIST_STAR },
				{ text: "🗑️ Delete Info", callback_data: ADMIN_DELETE },
			],
		],
	};
}

function getViewResultKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "1. Continue Query", callback_data: VIEW_CONTINUE },
				{ text: "2. Exit Query", callback_data: VIEW_EXIT },
			],
			[{ text: "3. Edit Info", callback_data: VIEW_EDIT }],
		],
	};
}

function getEditFieldKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "1. Avatar image URL", callback_data: EDIT_FIELD_AVATAR },
				{ text: "2. Telegram handle", callback_data: EDIT_FIELD_TELEGRAM },
			],
			[
				{ text: "3. X followers count", callback_data: EDIT_FIELD_FOLLOWERS },
				{ text: "4. List star event points", callback_data: EDIT_FIELD_STAR },
			],
			[{ text: "5. Super credit", callback_data: EDIT_FIELD_SUPER }],
		],
	};
}

function getEditConfirmKeyboard() {
	return {
		inline_keyboard: [[{ text: "✅ Confirm", callback_data: EDIT_CONFIRM_YES }, { text: "❌ Cancel", callback_data: EDIT_CONFIRM_NO }]],
	};
}

function getCreateConfirmKeyboard() {
	return {
		inline_keyboard: [[{ text: "✅ Yes", callback_data: CREATE_CONFIRM_YES }, { text: "❌ No", callback_data: CREATE_CONFIRM_NO }]],
	};
}

function getListStarConfirmKeyboard() {
	return {
		inline_keyboard: [[{ text: "✅ Yes", callback_data: LIST_STAR_CONFIRM_YES }, { text: "❌ No", callback_data: LIST_STAR_CONFIRM_NO }]],
	};
}

function normalizeHandle(input) {
	return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

function isValidHandleInput(text) {
	return /^@[A-Za-z0-9_]{1,15}$/.test(String(text || "").trim());
}

function formatHandle(handle) {
	const v = normalizeHandle(handle);
	return v ? `@${v}` : "";
}

function isValidTgHandle(input) {
	return /^@[A-Za-z0-9_]{4,32}$/.test(String(input || "").trim());
}

function sanitizeDisplayName(nameInput, handleInput) {
	let name = String(nameInput || "").trim();
	const handle = formatHandle(handleInput);
	const normalizedHandle = normalizeHandle(handleInput);
	if (!name) return "";

	if (handle) {
		const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		name = name.replace(new RegExp(`\\s*[-|/:：]\\s*${escapedHandle}\\s*$`, "i"), "");
		name = name.replace(new RegExp(`\\s*${escapedHandle}\\s*$`, "i"), "");
	}

	if (normalizedHandle) {
		const escapedNormalized = normalizedHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		name = name.replace(new RegExp(`\\s*[-|/:：]\\s*@?${escapedNormalized}\\s*$`, "i"), "");
		name = name.replace(new RegExp(`\\s*@${escapedNormalized}\\s*$`, "i"), "");
	}

	name = name.replace(/\s{2,}/g, " ").trim();
	if (!name) {
		return handle ? handle.replace(/^@/, "") : "";
	}
	return name;
}

function buildStarredName(nameInput) {
	let name = String(nameInput || "").trim();
	if (!name) return "⭐";
	name = name.replace(/^⭐\s*/u, "").trim();
	return `⭐ ${name}`;
}

function parseCreatePayload(input) {
	try {
		const obj = JSON.parse(String(input || ""));
		if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
			return { ok: false, reason: "JSON must be an object." };
		}
		for (const key of CREATE_REQUIRED_KEYS) {
			if (obj[key] === undefined || obj[key] === null || String(obj[key]).trim() === "") {
				return { ok: false, reason: `Missing required field: ${key}` };
			}
		}
		const cleaned = { ...obj };
		cleaned.handle = formatHandle(obj.handle);
		cleaned.name = sanitizeDisplayName(obj.name, cleaned.handle);
		if (!cleaned.name) {
			return { ok: false, reason: "Invalid name after cleanup." };
		}
		return { ok: true, data: cleaned };
	} catch {
		return { ok: false, reason: "Invalid JSON format." };
	}
}

function buildCreatePromptText(xHandleInput) {
	const xHandle = formatHandle(xHandleInput) || "@your_x_username";
	return [
		`Please collect profile info for X account ${xHandle} and return ONLY valid JSON (no markdown, no explanation).`,
		"Use exactly this schema and keys:",
		"{",
		'  "name": "X display name",',
		'  "handle": "X handle",',
		'  "sexual_orientation": "Sexual orientation",',
		'  "follower": "X followers count",',
		'  "profile_url": "X profile link",',
		'  "avatar": "Avatar image URL",',
		'  "bio": "X profile bio"',
		"}",
		`Rules: "name" must be pure display name only (do not include @handle or URL). The "handle" must be "${xHandle}".`,
		'If a field is unknown, return an empty string for that field.',
	].join("\n");
}

async function tg(env, method, payload) {
	const token = getBotToken(env);
	const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Telegram API ${method} failed: ${res.status} ${body}`);
	}
}

async function ensureSessionSchema(env) {
	if (!env.DB) {
		throw new Error("Missing D1 binding: DB");
	}
	if (!sessionSchemaPromise) {
		sessionSchemaPromise = env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS admin_session_state (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL DEFAULT '', target_handle TEXT NOT NULL DEFAULT '', edit_field TEXT NOT NULL DEFAULT '', draft_value TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY(chat_id, user_id))"
		).run();
	}
	await sessionSchemaPromise;
}

async function getSession(env, chatId, userId) {
	await ensureSessionSchema(env);
	const row = await env.DB.prepare(
		"SELECT action, target_handle, edit_field, draft_value FROM admin_session_state WHERE chat_id = ? AND user_id = ?"
	)
		.bind(String(chatId), String(userId))
		.first();
	if (!row) {
		return { action: "", targetHandle: "", editField: "", draftValue: "" };
	}
	return {
		action: String(row.action || ""),
		targetHandle: String(row.target_handle || ""),
		editField: String(row.edit_field || ""),
		draftValue: String(row.draft_value || ""),
	};
}

async function patchSession(env, chatId, userId, patch) {
	const current = await getSession(env, chatId, userId);
	const next = {
		action: patch.action !== undefined ? String(patch.action || "") : current.action,
		targetHandle: patch.targetHandle !== undefined ? String(patch.targetHandle || "") : current.targetHandle,
		editField: patch.editField !== undefined ? String(patch.editField || "") : current.editField,
		draftValue: patch.draftValue !== undefined ? String(patch.draftValue || "") : current.draftValue,
	};
	await env.DB.prepare(
		"INSERT INTO admin_session_state (chat_id, user_id, action, target_handle, edit_field, draft_value, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(chat_id, user_id) DO UPDATE SET action = excluded.action, target_handle = excluded.target_handle, edit_field = excluded.edit_field, draft_value = excluded.draft_value, created_at = excluded.created_at"
	)
		.bind(String(chatId), String(userId), next.action, next.targetHandle, next.editField, next.draftValue)
		.run();
	return next;
}

async function clearSession(env, chatId, userId) {
	await ensureSessionSchema(env);
	await env.DB.prepare("DELETE FROM admin_session_state WHERE chat_id = ? AND user_id = ?")
		.bind(String(chatId), String(userId))
		.run();
}

async function getTableColumns(env, table) {
	const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
	const rows = Array.isArray(result?.results) ? result.results : [];
	return new Set(rows.map((x) => String(x.name || "").toLowerCase()).filter(Boolean));
}

async function resolveEditColumn(env, table, fieldAction) {
	const spec = EDIT_FIELD_MAP[fieldAction];
	if (!spec) return null;
	const columns = await getTableColumns(env, table);
	if (columns.has(spec.column.toLowerCase())) {
		return spec.column;
	}
	if (spec.fallbackColumn && columns.has(spec.fallbackColumn.toLowerCase())) {
		return spec.fallbackColumn;
	}
	return null;
}

function formatProfile(profile) {
	const obj = profile || {};
	const lines = ["<b>✨ Profile Info</b>"];
	const used = new Set();

	for (const section of PROFILE_SECTIONS) {
		const sectionLines = [];
		for (const key of section.fields) {
			if (used.has(key)) continue;
			const rawValue = obj[key];
			if (rawValue === null || rawValue === undefined || rawValue === "") continue;
			used.add(key);
			let value = rawValue;
			if (typeof value === "object") {
				value = JSON.stringify(value);
			}
			const label = FIELD_DESCRIPTIONS[key] || key;
			const emoji = FIELD_EMOJIS[key] || "•";
			sectionLines.push(`${emoji} <b>${escapeHtml(label)}</b>: ${escapeHtml(value)}`);
		}
		if (sectionLines.length > 0) {
			lines.push("");
			lines.push(`<b>${escapeHtml(section.title)}</b>`);
			lines.push(...sectionLines);
		}
	}

	for (const [key, rawValue] of Object.entries(obj)) {
		if (used.has(key)) continue;
		if (rawValue === null || rawValue === undefined || rawValue === "") continue;
		let value = rawValue;
		if (typeof value === "object") {
			value = JSON.stringify(value);
		}
		const label = FIELD_DESCRIPTIONS[key] || key;
		const emoji = FIELD_EMOJIS[key] || "•";
		lines.push(`${emoji} <b>${escapeHtml(label)}</b>: ${escapeHtml(value)}`);
	}

	return lines.join("\n");
}

async function showEditFieldSelector(env, chatId, targetHandle) {
	const suffix = targetHandle ? `\nCurrent target: ${formatHandle(targetHandle)}` : "\nNo target selected yet.";
	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: `Choose a field to edit.${suffix}`,
		reply_markup: getEditFieldKeyboard(),
	});
}

async function handleViewInfo(env, chatId, userId, handleInput) {
	const handle = normalizeHandle(handleInput);
	if (!handle) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Invalid handle. Please use @xxx.",
		});
		return;
	}

	const table = getProfilesTable(env);
	const sql = `SELECT * FROM ${table} WHERE lower(ltrim(handle, '@')) = ? LIMIT 2`;
	const result = await env.DB.prepare(sql).bind(handle).all();
	const rows = Array.isArray(result?.results) ? result.results : [];

	if (rows.length === 0) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "No matching record found.",
		});
		return;
	}

	if (rows.length > 1) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Multiple matching records found. Please refine the handle.",
		});
		return;
	}

	await patchSession(env, chatId, userId, { action: "", targetHandle: handle, editField: "", draftValue: "" });

	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: formatProfile(rows[0]),
		parse_mode: "HTML",
		disable_web_page_preview: true,
		reply_markup: getViewResultKeyboard(),
	});
}

async function handleEditConfirm(env, chatId, userId, shouldSave) {
	const session = await getSession(env, chatId, userId);
	if (session.action !== EDIT_CONFIRM || !session.editField || !session.draftValue || !session.targetHandle) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "No pending edit found.",
		});
		return;
	}

	if (!shouldSave) {
		await patchSession(env, chatId, userId, { action: EDIT_SELECT, draftValue: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Edit cancelled. Choose another field.",
			reply_markup: getEditFieldKeyboard(),
		});
		return;
	}

	const table = getProfilesTable(env);
	const spec = EDIT_FIELD_MAP[session.editField];
	if (!spec) {
		await tg(env, "sendMessage", { chat_id: chatId, text: "Unknown edit field." });
		return;
	}

	const column = await resolveEditColumn(env, table, session.editField);
	if (!column) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `Column not found for \"${spec.label}\" in table ${table}.`,
		});
		return;
	}

	const sql = `UPDATE ${table} SET ${column} = ? WHERE lower(ltrim(handle, '@')) = ?`;
	const result = await env.DB.prepare(sql).bind(session.draftValue, normalizeHandle(session.targetHandle)).run();
	const changes = Number(result?.meta?.changes || 0);

	if (changes === 0) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `No record updated for ${formatHandle(session.targetHandle)}.`,
		});
		return;
	}

	await patchSession(env, chatId, userId, { action: EDIT_SELECT, draftValue: "" });
	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: `Updated ${spec.label} for ${formatHandle(session.targetHandle)}.`,
		reply_markup: getEditFieldKeyboard(),
	});
}

async function handleCreateConfirm(env, chatId, userId, shouldSave) {
	const session = await getSession(env, chatId, userId);
	if (session.action !== CREATE_CONFIRM || !session.draftValue || !session.editField) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "No pending create request found.",
		});
		return;
	}

	if (!shouldSave) {
		await patchSession(env, chatId, userId, { action: CREATE_WAIT_JSON, draftValue: "", editField: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Create cancelled. Paste a new JSON payload if you want to try again.",
		});
		return;
	}

	const parsed = parseCreatePayload(session.draftValue);
	if (!parsed.ok) {
		await patchSession(env, chatId, userId, { action: CREATE_WAIT_JSON, draftValue: "", editField: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `Saved draft is invalid: ${parsed.reason}\nPlease paste JSON again.`,
		});
		return;
	}

	const payload = parsed.data;
	const table = getProfilesTable(env);
	const normalizedHandle = normalizeHandle(payload.handle);
	if (!normalizedHandle) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Invalid handle in JSON.",
		});
		return;
	}

	const existing = await env.DB.prepare(`SELECT id FROM ${table} WHERE lower(ltrim(handle, '@')) = ? LIMIT 1`)
		.bind(normalizedHandle)
		.first();
	if (existing) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `Record already exists for ${formatHandle(normalizedHandle)}.`,
		});
		await clearSession(env, chatId, userId);
		return;
	}

	const columnsSet = await getTableColumns(env, table);
	const cols = [];
	const vals = [];

	function pushValue(column, value) {
		if (!columnsSet.has(column.toLowerCase())) return;
		cols.push(column);
		vals.push(value);
	}

	pushValue("name", String(payload.name).trim());
	pushValue("handle", formatHandle(payload.handle));
	pushValue("sexual_orientation", String(payload.sexual_orientation).trim());
	pushValue("profile_url", String(payload.profile_url).trim());
	pushValue("avatar", String(payload.avatar).trim());
	pushValue("bio", String(payload.bio).trim());
	pushValue("telegram", String(session.editField).trim());

	const followerNumeric = Number.parseInt(String(payload.follower).replace(/[^\d-]/g, ""), 10);
	const followerValue = Number.isFinite(followerNumeric) ? followerNumeric : String(payload.follower).trim();
	if (columnsSet.has("followers_count")) {
		cols.push("followers_count");
		vals.push(followerValue);
	} else if (columnsSet.has("follower")) {
		cols.push("follower");
		vals.push(followerValue);
	}

	if (columnsSet.has("created_at")) {
		cols.push("created_at");
		vals.push(new Date().toISOString().slice(0, 19).replace("T", " "));
	}

	if (cols.length === 0) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "No writable columns matched table schema.",
		});
		return;
	}

	const placeholders = cols.map(() => "?").join(", ");
	const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
	await env.DB.prepare(sql)
		.bind(...vals)
		.run();

	await clearSession(env, chatId, userId);
	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: `Created new record for ${formatHandle(payload.handle)}.`,
	});
}

async function getProfileByHandle(env, handleInput) {
	const handle = normalizeHandle(handleInput);
	if (!handle) {
		return { error: "Invalid handle." };
	}
	const table = getProfilesTable(env);
	const sql = `SELECT * FROM ${table} WHERE lower(ltrim(handle, '@')) = ? LIMIT 2`;
	const result = await env.DB.prepare(sql).bind(handle).all();
	const rows = Array.isArray(result?.results) ? result.results : [];
	if (rows.length === 0) {
		return { error: "No matching record found." };
	}
	if (rows.length > 1) {
		return { error: "Multiple matching records found. Please refine the handle." };
	}
	return { row: rows[0], handle };
}

async function prepareListStarPreview(env, chatId, userId, handleInput) {
	const profile = await getProfileByHandle(env, handleInput);
	if (profile.error) {
		await tg(env, "sendMessage", { chat_id: chatId, text: profile.error });
		return;
	}
	const updated = {
		...profile.row,
		name: buildStarredName(profile.row?.name),
		list_star_event_cnt: 1000,
		super_credit: 100000000,
	};
	await patchSession(env, chatId, userId, {
		action: LIST_STAR_CONFIRM,
		targetHandle: profile.handle,
		editField: "",
		draftValue: "",
	});
	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: `${formatProfile(updated)}\n\nApply this update?`,
		parse_mode: "HTML",
		disable_web_page_preview: true,
		reply_markup: getListStarConfirmKeyboard(),
	});
}

async function handleListStarConfirm(env, chatId, userId, shouldSave) {
	const session = await getSession(env, chatId, userId);
	if (session.action !== LIST_STAR_CONFIRM || !session.targetHandle) {
		await tg(env, "sendMessage", { chat_id: chatId, text: "No pending List Star request found." });
		return;
	}
	if (!shouldSave) {
		await patchSession(env, chatId, userId, { action: "", editField: "", draftValue: "" });
		await tg(env, "sendMessage", { chat_id: chatId, text: "List Star update cancelled." });
		return;
	}

	const profile = await getProfileByHandle(env, session.targetHandle);
	if (profile.error) {
		await tg(env, "sendMessage", { chat_id: chatId, text: profile.error });
		return;
	}

	const table = getProfilesTable(env);
	const columns = await getTableColumns(env, table);
	const sets = [];
	const values = [];

	if (columns.has("name")) {
		sets.push("name = ?");
		values.push(buildStarredName(profile.row?.name));
	}
	if (columns.has("list_star_event_cnt")) {
		sets.push("list_star_event_cnt = ?");
		values.push(1000);
	}
	if (columns.has("super_credit")) {
		sets.push("super_credit = ?");
		values.push(100000000);
	}

	if (sets.length === 0) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "No target columns found (name/list_star_event_cnt/super_credit).",
		});
		return;
	}

	values.push(normalizeHandle(session.targetHandle));
	const sql = `UPDATE ${table} SET ${sets.join(", ")} WHERE lower(ltrim(handle, '@')) = ?`;
	const updateResult = await env.DB.prepare(sql).bind(...values).run();
	const changes = Number(updateResult?.meta?.changes || 0);
	if (changes === 0) {
		await tg(env, "sendMessage", { chat_id: chatId, text: "No record updated." });
		return;
	}

	const refreshed = await getProfileByHandle(env, session.targetHandle);
	await patchSession(env, chatId, userId, { action: "", editField: "", draftValue: "" });
	if (refreshed.row) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `${formatProfile(refreshed.row)}\n\nList Star update applied.`,
			parse_mode: "HTML",
			disable_web_page_preview: true,
		});
		return;
	}
	await tg(env, "sendMessage", { chat_id: chatId, text: "List Star update applied." });
}

async function handleAdminCallback(env, callbackQuery) {
	const callbackId = callbackQuery?.id;
	const action = String(callbackQuery?.data || "");
	const chatId = callbackQuery?.message?.chat?.id;
	const userId = callbackQuery?.from?.id;

	if (!callbackId) {
		return;
	}

	if (!chatId || !userId) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Invalid callback context.",
		});
		return;
	}

	if (action === VIEW_CONTINUE || action === ADMIN_VIEW) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter an X handle in format @xxx.",
		});
		await patchSession(env, chatId, userId, { action: ADMIN_VIEW, editField: "", draftValue: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Please enter an X handle in format @xxx",
		});
		return;
	}

	if (action === VIEW_EXIT) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Query exited.",
		});
		await clearSession(env, chatId, userId);
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Query exited. Send /admin to start again.",
		});
		return;
	}

	if (action === VIEW_EDIT || action === ADMIN_EDIT) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Choose a field to edit.",
		});
		const session = await patchSession(env, chatId, userId, { action: EDIT_SELECT, editField: "", draftValue: "" });
		await showEditFieldSelector(env, chatId, session.targetHandle);
		return;
	}

	if (EDIT_FIELD_ACTIONS.has(action)) {
		const spec = EDIT_FIELD_MAP[action];
		const session = await getSession(env, chatId, userId);
		if (!session.targetHandle) {
			await tg(env, "answerCallbackQuery", {
				callback_query_id: callbackId,
				text: "Please query a handle first.",
			});
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Please use View Info first, then return to Edit Info.",
			});
			return;
		}
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: `Editing ${spec.label}`,
		});
		await patchSession(env, chatId, userId, { action: EDIT_INPUT, editField: action, draftValue: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `Please input new value for ${spec.label} of ${formatHandle(session.targetHandle)}.`,
		});
		return;
	}

	if (action === EDIT_CONFIRM_YES || action === EDIT_CONFIRM_NO) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: action === EDIT_CONFIRM_YES ? "Saving..." : "Cancelled.",
		});
		await handleEditConfirm(env, chatId, userId, action === EDIT_CONFIRM_YES);
		return;
	}

	if (action === CREATE_CONFIRM_YES || action === CREATE_CONFIRM_NO) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: action === CREATE_CONFIRM_YES ? "Creating..." : "Cancelled.",
		});
		await handleCreateConfirm(env, chatId, userId, action === CREATE_CONFIRM_YES);
		return;
	}

	if (action === LIST_STAR_CONFIRM_YES || action === LIST_STAR_CONFIRM_NO) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: action === LIST_STAR_CONFIRM_YES ? "Applying..." : "Cancelled.",
		});
		await handleListStarConfirm(env, chatId, userId, action === LIST_STAR_CONFIRM_YES);
		return;
	}

	if (action === ADMIN_CREATE) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter your X handle first.",
		});
		await patchSession(env, chatId, userId, { action: CREATE_WAIT_X_HANDLE, editField: "", draftValue: "", targetHandle: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Please input your X handle first (format: @xxx).",
		});
		return;
	}

	if (action === ADMIN_ADD_LIST_STAR) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter an X handle in format @xxx.",
		});
		await patchSession(env, chatId, userId, { action: LIST_STAR_WAIT_HANDLE, editField: "", draftValue: "", targetHandle: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Please input X handle to add List Star (format: @xxx).",
		});
		return;
	}

	if (action === ADMIN_DELETE) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "This action is not implemented yet.",
		});
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "This action is not implemented yet.",
		});
		return;
	}

	if (ADMIN_ACTIONS.has(action)) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter an X handle in format @xxx.",
		});
		await patchSession(env, chatId, userId, { action, editField: "", draftValue: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Please enter an X handle in format @xxx",
		});
	}
}

async function handleMessage(env, message) {
	const chatId = message?.chat?.id;
	const userId = message?.from?.id;
	const text = String(message?.text || "").trim();
	if (!chatId || !userId || !text) {
		return;
	}

	if (isAdminCommand(text)) {
		await patchSession(env, chatId, userId, { action: "", editField: "", draftValue: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Admin panel: choose an action.",
			reply_markup: getAdminKeyboard(),
		});
		return;
	}

	const session = await getSession(env, chatId, userId);

	if (session.action === ADMIN_VIEW) {
		if (!isValidHandleInput(text)) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Invalid format. Please enter handle as @xxx",
			});
			return;
		}
		await handleViewInfo(env, chatId, userId, text);
		return;
	}

	if (session.action === CREATE_WAIT_X_HANDLE) {
		if (!isValidHandleInput(text)) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Invalid X handle format. Please use @xxx",
			});
			return;
		}
		await patchSession(env, chatId, userId, {
			action: CREATE_WAIT_JSON,
			targetHandle: normalizeHandle(text),
			editField: "",
			draftValue: "",
		});
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Step 1/3: Copy only the next message and send it to Grok.",
		});
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: buildCreatePromptText(text),
		});
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Step 3/3: Paste only Grok's JSON reply here (do not include extra text).",
		});
		return;
	}

	if (session.action === LIST_STAR_WAIT_HANDLE) {
		if (!isValidHandleInput(text)) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Invalid X handle format. Please use @xxx",
			});
			return;
		}
		await prepareListStarPreview(env, chatId, userId, text);
		return;
	}

	if (session.action === CREATE_WAIT_JSON) {
		const parsed = parseCreatePayload(text);
		if (!parsed.ok) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: `Invalid JSON: ${parsed.reason}\nPlease paste valid JSON payload.`,
			});
			return;
		}
		await patchSession(env, chatId, userId, {
			action: CREATE_WAIT_TG,
			draftValue: JSON.stringify(parsed.data),
			editField: "",
			targetHandle: "",
		});
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Now input your Telegram handle in format @username",
		});
		return;
	}

	if (session.action === CREATE_WAIT_TG) {
		if (!isValidTgHandle(text)) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Invalid Telegram handle format. Please use @username",
			});
			return;
		}
		const parsed = parseCreatePayload(session.draftValue);
		if (!parsed.ok) {
			await patchSession(env, chatId, userId, { action: CREATE_WAIT_JSON, draftValue: "", editField: "" });
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Stored JSON is invalid. Please paste JSON again.",
			});
			return;
		}

		const data = parsed.data;
		await patchSession(env, chatId, userId, { action: CREATE_CONFIRM, editField: text.trim() });
		const previewLines = [
			"Preview (please confirm):",
			`name: ${data.name}`,
			`handle: ${data.handle}`,
			`sexual_orientation: ${data.sexual_orientation}`,
			`follower: ${data.follower}`,
			`profile_url: ${data.profile_url}`,
			`avatar: ${data.avatar}`,
			`bio: ${data.bio}`,
			`telegram: ${text.trim()}`,
			"",
			"Create this record?",
		];
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: previewLines.join("\n"),
			reply_markup: getCreateConfirmKeyboard(),
		});
		return;
	}

	if (session.action === EDIT_INPUT) {
		const spec = EDIT_FIELD_MAP[session.editField];
		if (!spec) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Unknown edit field. Please choose field again.",
				reply_markup: getEditFieldKeyboard(),
			});
			await patchSession(env, chatId, userId, { action: EDIT_SELECT, editField: "", draftValue: "" });
			return;
		}

		await patchSession(env, chatId, userId, { action: EDIT_CONFIRM, draftValue: text });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: `Confirm update?\nField: ${spec.label}\nTarget: ${formatHandle(session.targetHandle)}\nNew value: ${text}`,
			reply_markup: getEditConfirmKeyboard(),
		});
		return;
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/cf-webhook") {
			return handleCloudflareWebhook(request, env, url);
		}
		if (url.pathname.startsWith("/admin")) {
			return handleAdminConsole(request, env, url);
		}

		if (request.method !== "POST") {
			return new Response("Not found", { status: 404 });
		}

		const update = await request.json().catch(() => null);
		if (!update) {
			return new Response("Bad request", { status: 400 });
		}

		try {
			if (update.callback_query) {
				await handleAdminCallback(env, update.callback_query);
			}
			if (update.message) {
				await handleMessage(env, update.message);
			}
		} catch (err) {
			console.error("Update handling failed:", err);
			return new Response(`Update handling failed: ${String(err?.message || err)}`, { status: 500 });
		}

		return new Response("ok", { status: 200 });
	},
};
