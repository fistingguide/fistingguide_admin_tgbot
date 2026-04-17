"use strict";

const ADMIN_VIEW = "admin:view_info";
const ADMIN_EDIT = "admin:edit_info";
const ADMIN_CREATE = "admin:create_info";
const ADMIN_DELETE = "admin:delete_info";
const VIEW_CONTINUE = "view:continue_query";
const VIEW_EXIT = "view:exit_query";
const VIEW_EDIT = "view:edit_info";
const ADMIN_ACTIONS = new Set([ADMIN_VIEW, ADMIN_EDIT, ADMIN_CREATE, ADMIN_DELETE]);
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
				{ text: "1. View Info", callback_data: ADMIN_VIEW },
				{ text: "2. Edit Info", callback_data: ADMIN_EDIT },
			],
			[
				{ text: "3. Create Info", callback_data: ADMIN_CREATE },
				{ text: "4. Delete Info", callback_data: ADMIN_DELETE },
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

function normalizeHandle(input) {
	return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

function isValidHandleInput(text) {
	return /^@[A-Za-z0-9_]{1,15}$/.test(String(text || "").trim());
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
			"CREATE TABLE IF NOT EXISTS admin_sessions (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(chat_id, user_id))"
		).run();
	}
	await sessionSchemaPromise;
}

async function setPendingAction(env, chatId, userId, action) {
	await ensureSessionSchema(env);
	await env.DB.prepare(
		"INSERT OR REPLACE INTO admin_sessions (chat_id, user_id, action, created_at) VALUES (?, ?, ?, datetime('now'))"
	)
		.bind(String(chatId), String(userId), String(action))
		.run();
}

async function getPendingAction(env, chatId, userId) {
	await ensureSessionSchema(env);
	const row = await env.DB.prepare("SELECT action FROM admin_sessions WHERE chat_id = ? AND user_id = ?")
		.bind(String(chatId), String(userId))
		.first();
	return row?.action ? String(row.action) : "";
}

async function clearPendingAction(env, chatId, userId) {
	await ensureSessionSchema(env);
	await env.DB.prepare("DELETE FROM admin_sessions WHERE chat_id = ? AND user_id = ?")
		.bind(String(chatId), String(userId))
		.run();
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

async function handleViewInfo(env, chatId, handleInput) {
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

	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: formatProfile(rows[0]),
		parse_mode: "HTML",
		disable_web_page_preview: true,
		reply_markup: getViewResultKeyboard(),
	});
}

async function handleAdminCallback(env, callbackQuery) {
	const callbackId = callbackQuery?.id;
	const action = String(callbackQuery?.data || "");
	const chatId = callbackQuery?.message?.chat?.id;
	const userId = callbackQuery?.from?.id;

	if (!callbackId) {
		return;
	}

	if (action === VIEW_CONTINUE) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter an X handle in format @xxx.",
		});
		if (chatId && userId) {
			await setPendingAction(env, chatId, userId, ADMIN_VIEW);
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Please enter an X handle in format @xxx",
			});
		}
		return;
	}

	if (action === VIEW_EXIT) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Query exited.",
		});
		if (chatId && userId) {
			await clearPendingAction(env, chatId, userId);
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Query exited. Send /admin to start again.",
			});
		}
		return;
	}

	if (action === VIEW_EDIT) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please enter an X handle in format @xxx.",
		});
		if (chatId && userId) {
			await setPendingAction(env, chatId, userId, ADMIN_EDIT);
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "Please enter an X handle in format @xxx",
			});
		}
		return;
	}

	if (!ADMIN_ACTIONS.has(action)) {
		return;
	}

	await tg(env, "answerCallbackQuery", {
		callback_query_id: callbackId,
		text: "Please enter an X handle in format @xxx.",
	});

	if (!chatId || !userId) {
		return;
	}

	await setPendingAction(env, chatId, userId, action);
	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: "Please enter an X handle in format @xxx",
	});
}

async function handleMessage(env, message) {
	const chatId = message?.chat?.id;
	const userId = message?.from?.id;
	const text = String(message?.text || "").trim();
	if (!chatId || !text) {
		return;
	}

	if (isAdminCommand(text)) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Admin panel: choose an action.",
			reply_markup: getAdminKeyboard(),
		});
		return;
	}

	if (!userId) {
		return;
	}

	const action = await getPendingAction(env, chatId, userId);
	if (!ADMIN_ACTIONS.has(action)) {
		return;
	}

	if (!isValidHandleInput(text)) {
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: "Invalid format. Please enter handle as @xxx",
		});
		return;
	}

	if (action === ADMIN_VIEW) {
		await handleViewInfo(env, chatId, text);
		await clearPendingAction(env, chatId, userId);
		return;
	}

	await tg(env, "sendMessage", {
		chat_id: chatId,
		text: "This action is not implemented yet.",
	});
	await clearPendingAction(env, chatId, userId);
}

export default {
	async fetch(request, env) {
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
