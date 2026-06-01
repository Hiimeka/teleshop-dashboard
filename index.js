require('dotenv').config();
const ShopBot = require('./bot/bot');
const APIServer = require('./bot/api-server');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ditemukan di .env');
  process.exit(1);
}
if (!ADMIN_IDS.length) {
  console.warn('⚠️  ADMIN_IDS tidak diset. Tidak ada admin aktif!');
}

const bot = new ShopBot(BOT_TOKEN, ADMIN_IDS);
const api = new APIServer(bot); // port otomatis dari Railway
api.start();

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
