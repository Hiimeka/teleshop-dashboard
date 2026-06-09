require('dotenv').config();
const ShopBot   = require('./bot/bot');
const APIServer = require('./bot/api-server');

console.log('🚀 Starting ShopBot...');
console.log('📦 Node.js version:', process.version);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', process.env.PORT || 3000);

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ditemukan! Set BOT_TOKEN di Railway Variables.');
  process.exit(1);
}
if (!ADMIN_IDS.length) {
  console.warn('⚠️  ADMIN_IDS tidak diset. Set ADMIN_IDS di Railway Variables.');
}

// Mulai API server dulu (Railway butuh port terbuka segera)
const mockBot = { db: null, bot: null, adminIds: ADMIN_IDS, pakasir: null };
const api = new APIServer(mockBot);
api.start();

// Baru init bot Telegram (bisa butuh waktu)
const bot = new ShopBot(BOT_TOKEN, ADMIN_IDS);
// Sambungkan bot ke api server setelah init
api.bot    = bot;
api.db     = bot.db;
api.pakasir = bot.pakasir;

process.on('uncaughtException',  (err) => console.error('❌ Uncaught Exception:', err.message));
process.on('unhandledRejection', (err) => console.error('❌ Unhandled Rejection:', err?.message || err));
