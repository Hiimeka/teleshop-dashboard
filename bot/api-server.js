const express = require('express');
const cors = require('cors');
const Database = require('./database');
const { formatCurrency } = require('./utils');

class APIServer {
  constructor(bot) {
    this.app = express();
    this.db = bot.db;
    this.bot = bot;
    // Railway otomatis inject PORT, fallback 3000 untuk lokal
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors({ origin: '*' }));
    this.app.use(express.json());

    // API Key auth
    const REQUIRED_KEY = process.env.DASHBOARD_API_KEY;

    if (!REQUIRED_KEY) {
      console.warn('⚠️  WARNING: DASHBOARD_API_KEY tidak diset di .env!');
      console.warn('   API terbuka tanpa autentikasi. Set DASHBOARD_API_KEY untuk keamanan.');
    } else {
      console.log('🔐 API Key auth aktif.');
    }

    this.app.use((req, res, next) => {
      // /health selalu bisa diakses
      if (req.path === '/health') return next();

      // Kalau DASHBOARD_API_KEY tidak diset, biarkan semua request lewat
      if (!REQUIRED_KEY) return next();

      // Cek dari header atau query string
      const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.apiKey;

      if (!key) {
        return res.status(401).json({ error: 'Unauthorized', message: 'API key tidak ditemukan. Kirim via header x-api-key' });
      }

      if (key !== REQUIRED_KEY) {
        return res.status(401).json({ error: 'Unauthorized', message: 'API key salah' });
      }

      next();
    });
  }

  setupRoutes() {
    const r = this.app;

    r.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

    // ── DASHBOARD STATS ──
    r.get('/api/stats', (_, res) => {
      const report = this.db.getDailyReport();
      const products = this.db.getProducts();
      const orders = this.db.getAllOrders();
      const users = this.db.getAllUsers();
      const allStock = this.db.getAllStock();
      res.json({
        revenue_today: report.revenue,
        sold_today: report.sold,
        total_orders: orders.length,
        pending_orders: orders.filter(o => o.status === 'pending').length,
        total_products: products.length,
        total_users: users.length,
        total_stock: allStock.filter(s => !s.sold).length,
        preorders: report.preorders,
        cancelled_today: report.cancelled
      });
    });

    // ── REVENUE CHART ──
    r.get('/api/revenue', (req, res) => {
      const days = parseInt(req.query.days) || 7;
      res.json(this.db.getRevenueChart(days));
    });

    // ── PRODUCTS ──
    r.get('/api/products', (_, res) => {
      const products = this.db.getProducts();
      const result = products.map(p => ({
        ...p,
        stock_count: this.db.getStockCount(p.id)
      }));
      res.json(result);
    });
    r.post('/api/products', (req, res) => {
      const product = { id: Date.now().toString(), active: true, created_at: Date.now(), ...req.body };
      this.db.addProduct(product);
      res.json({ success: true, product });
    });
    r.put('/api/products/:id', (req, res) => {
      this.db.updateProduct(req.params.id, req.body);
      res.json({ success: true });
    });
    r.delete('/api/products/:id', (req, res) => {
      this.db.deleteProduct(req.params.id);
      res.json({ success: true });
    });

    // ── STOCK ──
    r.get('/api/stock', (_, res) => res.json(this.db.getAllStock()));
    r.post('/api/stock', (req, res) => {
      const { product_id, items } = req.body;
      let added = 0;
      for (const item of (items || [])) {
        this.db.addStockItem(product_id, item);
        added++;
      }
      res.json({ success: true, added });
    });
    r.delete('/api/stock/:id', (req, res) => {
      this.db.deleteStockItem(req.params.id);
      res.json({ success: true });
    });

    // ── ORDERS ──
    r.get('/api/orders', (req, res) => {
      let orders = this.db.getAllOrders();
      if (req.query.status) orders = orders.filter(o => o.status === req.query.status);
      orders.sort((a, b) => b.created_at - a.created_at);
      res.json(orders);
    });
    r.put('/api/orders/:id/confirm', async (req, res) => {
      try {
        const order = this.db.getOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        const stockItem = this.db.getRandomStock(order.product_id);
        this.db.updateOrderStatus(order.id, 'delivered');
        if (stockItem) this.db.markStockSold(stockItem.id, order.id);
        const deliveryText = stockItem
          ? `✅ *Pembayaran Dikonfirmasi!*\n\n🔖 Order: \`${order.id}\`\n📦 *${order.product_name}*\n\n🎁 *Detail:*\n\`\`\`\n${stockItem.data}\n\`\`\`\n\n_Terima kasih! 🙏_`
          : `✅ *Dikonfirmasi!* Produk pre-order sedang diproses.`;
        await this.bot.bot.sendMessage(order.user_id, deliveryText, { parse_mode: 'Markdown' });
        this.db.recordSale(order);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    r.put('/api/orders/:id/reject', async (req, res) => {
      try {
        const order = this.db.getOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        this.db.updateOrderStatus(order.id, 'cancelled');
        await this.bot.bot.sendMessage(order.user_id, `❌ *Pesanan Dibatalkan*\n\nOrder \`${order.id}\` untuk *${order.product_name}* dibatalkan.`, { parse_mode: 'Markdown' });
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── TRIGGERS ──
    r.get('/api/triggers', (_, res) => res.json(this.db.getTriggers()));
    r.post('/api/triggers', (req, res) => {
      this.db.addTrigger({ ...req.body, created_at: Date.now() });
      res.json({ success: true });
    });
    r.delete('/api/triggers/:trigger', (req, res) => {
      this.db.deleteTrigger(decodeURIComponent(req.params.trigger));
      res.json({ success: true });
    });

    // ── USERS ──
    r.get('/api/users', (_, res) => res.json(this.db.getAllUsers()));

    // ── BROADCAST ──
    r.post('/api/broadcast', async (req, res) => {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });
      const users = this.db.getAllUserIds();
      let sent = 0, failed = 0;
      for (const userId of users) {
        try {
          await this.bot.bot.sendMessage(userId, `📢 *Pengumuman*\n\n${message}`, { parse_mode: 'Markdown' });
          sent++;
          await new Promise(r => setTimeout(r, 60));
        } catch { failed++; }
      }
      res.json({ success: true, sent, failed });
    });

    // ── REPORT ──
    r.get('/api/report/daily', (_, res) => res.json(this.db.getDailyReport()));

    // ── PAYMENT INFO ──
    r.get('/api/payment', (_, res) => res.json(this.db.getPaymentInfo()));
    r.put('/api/payment', (req, res) => {
      const { text } = req.body;
      const existing = this.db.getPaymentInfo();
      this.db.setPaymentInfo(text, existing?.photo_file_id || null);
      res.json({ success: true });
    });

    // ── SETTINGS ──
    r.get('/api/settings', (_, res) => res.json(this.db.getSettings()));
    r.put('/api/settings', (req, res) => {
      this.db.setAutoOrder(req.body.auto_order);
      res.json({ success: true });
    });
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🌐 API Server running on port ${this.port}`);
    });
  }
}

module.exports = APIServer;
