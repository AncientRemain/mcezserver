// Discord webhook notifications for server events.
const { UA } = require('./net');

const VALID = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const COLORS = { online: 0x34d399, offline: 0x8d96a7, crash: 0xf87171, join: 0x60a5fa, leave: 0xa78bfa, backup: 0xfbbf24, start: 0xfbbf24, test: 0x34d399 };
const EVENTS = ['online', 'offline', 'crash', 'join', 'leave', 'backup'];

const isValid = (url) => VALID.test(String(url || '').trim());

/** Sends one embed. Resolves to true on success; never throws for network errors unless `strict`. */
async function send(url, { event, title, text, server }, strict = false) {
  if (!isValid(url)) { if (strict) throw new Error('That is not a Discord webhook URL (it should start with https://discord.com/api/webhooks/).'); return false; }
  const body = {
    username: 'CraftDock',
    embeds: [{ title: String(title).slice(0, 250), description: String(text || '').slice(0, 2000), color: COLORS[event] || 0x34d399, footer: { text: server ? `CraftDock · ${server}` : 'CraftDock' }, timestamp: new Date().toISOString() }],
  };
  try {
    const res = await fetch(url.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Discord answered HTTP ${res.status}`);
    return true;
  } catch (e) {
    if (strict) throw e;
    return false;
  }
}

module.exports = { send, isValid, EVENTS };
