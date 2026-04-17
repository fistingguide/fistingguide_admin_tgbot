"use strict";

const ADMIN_VIEW = "admin:view_info";
const ADMIN_EDIT = "admin:edit_info";
const ADMIN_CREATE = "admin:create_info";
const ADMIN_DELETE = "admin:delete_info";

const VIEW_CONTINUE = "view:continue_query";
const VIEW_EXIT = "view:exit_query";
const VIEW_EDIT = "view:edit_info";

const EDIT_SELECT = "edit:select_field";
const EDIT_INPUT = "edit:input_value";
const EDIT_CONFIRM = "edit:confirm_value";
const CREATE_WAIT_JSON = "create:wait_json";
const CREATE_WAIT_TG = "create:wait_tg_handle";
const CREATE_CONFIRM = "create:confirm";

const EDIT_FIELD_AVATAR = "edit_field:avatar";
const EDIT_FIELD_TELEGRAM = "edit_field:telegram";
const EDIT_FIELD_FOLLOWERS = "edit_field:followers_count";
const EDIT_FIELD_STAR = "edit_field:list_star_event_cnt";
const EDIT_FIELD_SUPER = "edit_field:super_credit";

const EDIT_CONFIRM_YES = "edit_confirm:yes";
const EDIT_CONFIRM_NO = "edit_confirm:no";
const CREATE_CONFIRM_YES = "create_confirm:yes";
const CREATE_CONFIRM_NO = "create_confirm:no";
const CREATE_REQUIRED_KEYS = ["name", "handle", "sexual_orientation", "follower", "profile_url", "avatar", "bio"];

const EDIT_FIELD_MAP = {
	[EDIT_FIELD_AVATAR]: { column: "avatar", label: "Avatar image URL" },
	[EDIT_FIELD_TELEGRAM]: { column: "telegram", label: "Telegram handle" },
	[EDIT_FIELD_FOLLOWERS]: { column: "followers_count", fallbackColumn: "follower", label: "X followers count" },
	[EDIT_FIELD_STAR]: { column: "list_star_event_cnt", label: "List star event points" },
	[EDIT_FIELD_SUPER]: { column: "super_credit", label: "Super credit" },
};

const ADMIN_ACTIONS = new Set([ADMIN_VIEW, ADMIN_EDIT, ADMIN_CREATE, ADMIN_DELETE]);
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
				{ text: "1. 🔍 View Info", callback_data: ADMIN_VIEW },
				{ text: "2. ➕ Create Info", callback_data: ADMIN_CREATE },
			],
			[{ text: "3. 🗑️ Delete Info", callback_data: ADMIN_DELETE }],
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
		return { ok: true, data: obj };
	} catch {
		return { ok: false, reason: "Invalid JSON format." };
	}
}

function buildCreatePromptText() {
	return [
		"Use Grok to collect these fields about yourself and output JSON:",
		"{",
		'  "name": "X display name",',
		'  "handle": "X handle",',
		'  "sexual_orientation": "Sexual orientation",',
		'  "follower": "X followers count",',
		'  "profile_url": "X profile link",',
		'  "avatar": "Avatar image URL",',
		'  "bio": "X profile bio"',
		"}",
		"Then paste the JSON here.",
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

	if (action === ADMIN_CREATE) {
		await tg(env, "answerCallbackQuery", {
			callback_query_id: callbackId,
			text: "Please paste JSON generated by Grok.",
		});
		await patchSession(env, chatId, userId, { action: CREATE_WAIT_JSON, editField: "", draftValue: "", targetHandle: "" });
		await tg(env, "sendMessage", {
			chat_id: chatId,
			text: buildCreatePromptText(),
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
