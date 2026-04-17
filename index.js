"use strict";

function getBotToken(env) {
	const token = String(env.TG_BOT_TOKEN || env.CREDIT_TG_BOT_TOKEN || "").trim();
	if (!token) {
		throw new Error("Missing TG_BOT_TOKEN/CREDIT_TG_BOT_TOKEN in Worker env");
	}
	return token;
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

function isEchoCommand(text) {
	if (!text) return false;
	const command = String(text).trim().split(/\s+/)[0].toLowerCase();
	return command === "/echo" || command.startsWith("/echo@");
}

export default {
	async fetch(request, env) {
		if (request.method !== "POST") {
			return new Response("Not found", { status: 404 });
		}

		const update = await request.json().catch(() => null);
		const message = update?.message;
		const chatId = message?.chat?.id;
		const text = message?.text;

		if (chatId && isEchoCommand(text)) {
			await tg(env, "sendMessage", {
				chat_id: chatId,
				text: "你好ddd",
			});
		}

		return new Response("ok", { status: 200 });
	},
};
