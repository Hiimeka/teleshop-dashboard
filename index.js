require('dotenv').config();

console.log('🚀 ShopBot starting...');
console.log('📦 Node.js:', process.version);
console.log('🔌 Port:', process.env.PORT || 3000);

const express   = require('express');
const cors      = require('cors');
const APIServer = require('./bot/api-server');
const Database  = require('./bot/database');

// ── 1. Start HTTP server SEGERA agar Railway health check tidak timeout ──
const db  = new Database();
const tempBot = { db, bot: null, adminIds: [], pakasir: null };
const api = new APIServer(tempBot);
api.start(); // Server listen sekarang, health check langsung bisa diakses

// ── 2. Init Telegram Bot secara async (tidak blokir server) ──────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ditemukan! Set di Railway Variables.');
  // Jangan exit — biarkan server tetap jalan agar health check OK
  // Bot tidak akan aktif tapi API dashboard tetap bisa diakses
} else {
  // Init bot setelah server sudah jalan
  setImmediate(() => {
    try {
      const ShopBot = require('./bot/bot');
      const bot     = new ShopBot(BOT_TOKEN, ADMIN_IDS);

      // Sambungkan bot ke API server
      api.bot     = bot;
      api.db      = bot.db;
      api.pakasir = bot.pakasir || null;

      // Update tempBot reference juga
      tempBot.bot     = bot.bot;
      tempBot.adminIds = bot.adminIds;

      console.log('✅ Telegram bot connected to API server');
    } catch (e) {
      console.error('❌ Bot init error:', e.message);
      // Server tetap jalan meski bot error
    }
  });
}

// ── Error handlers ────────────────────────────────────────────────────────
process.on('uncaughtException',  err => console.error('❌ Uncaught:', err.message));
process.on('unhandledRejection', err => console.error('❌ Unhandled:', err?.message || err));
