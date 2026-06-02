const express = require('express');
const cors    = require('cors');
const Database = require('./database');
const { generateToken, authMiddleware, adminOnly } = require('./auth');

class APIServer {
  constructor(bot) {
    this.app  = express();
    this.db   = bot.db;
    this.bot  = bot;
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors({ origin: '*' }));
    this.app.use(express.json());

    // Log semua request ke console
    this.app.use((req, res, next) => {
      if (req.path !== '/health') console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    const r = this.app;

    // ── PUBLIC ────────────────────────────────────────────────
    r.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

    // LOGIN
    r.post('/api/auth/login', (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
      try {
        const user = this.db.verifyPassword(username, password);
        if (!user) return res.status(401).json({ error: 'Username atau password salah' });
        const token = generateToken(user);
        this.db.addLog({ user_id: user.id, username: user.username, action: 'LOGIN', detail: 'Login berhasil', ip: req.ip });
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── PROTECTED (semua butuh login) ─────────────────────────
    r.use(authMiddleware);

    // Helper log
    const log = (req, action, detail='') => {
      this.db.addLog({ user_id: req.user.id, username: req.user.username, action, detail, ip: req.ip });
    };

    // ── STATS ─────────────────────────────────────────────────
    r.get('/api/stats', (_, res) => {
      const report   = this.db.getDailyReport();
      const products = this.db.getProducts();
      const orders   = this.db.getAllOrders();
      const users    = this.db.getAllUsers();
      const allStock = this.db.getAllStock();
      res.json({
        revenue_today:  report.revenue,
        sold_today:     report.sold,
        total_orders:   orders.length,
        pending_orders: orders.filter(o=>o.status==='pending').length,
        total_products: products.length,
        total_users:    users.length,
        total_stock:    allStock.filter(s=>!s.sold).length,
        preorders:      report.preorders,
        cancelled_today:report.cancelled
      });
    });

    r.get('/api/revenue', (req, res) => res.json(this.db.getRevenueChart(parseInt(req.query.days)||7)));

    // ── PRODUCTS ──────────────────────────────────────────────
    r.get('/api/products', (_, res) => {
      const products = this.db.getProducts().map(p => ({ ...p, stock_count: this.db.getStockCount(p.id) }));
      res.json(products);
    });
    r.post('/api/products', (req, res) => {
      const product = { id: Date.now().toString(), active: true, created_at: Date.now(), created_by: req.user.username, ...req.body };
      this.db.addProduct(product);
      log(req, 'ADD_PRODUCT', `Tambah produk: ${product.name} - Rp${product.price}`);
      res.json({ success: true, product });
    });
    r.put('/api/products/:id', (req, res) => {
      this.db.updateProduct(req.params.id, req.body);
      log(req, 'EDIT_PRODUCT', `Edit produk ID: ${req.params.id}`);
      res.json({ success: true });
    });
    r.delete('/api/products/:id', (req, res) => {
      const p = this.db.getProductById(req.params.id);
      this.db.deleteProduct(req.params.id);
      log(req, 'DELETE_PRODUCT', `Hapus produk: ${p?.name || req.params.id}`);
      res.json({ success: true });
    });

    // ── STOCK ─────────────────────────────────────────────────
    r.get('/api/stock', (_, res) => res.json(this.db.getAllStock()));
    r.post('/api/stock', (req, res) => {
      const { product_id, items } = req.body;
      const product = this.db.getProductById(product_id);
      let added = 0;
      for (const item of (items||[])) { this.db.addStockItem(product_id, item); added++; }
      log(req, 'ADD_STOCK', `Tambah ${added} stok untuk: ${product?.name || product_id}`);
      res.json({ success: true, added });
    });
    r.delete('/api/stock/:id', (req, res) => {
      this.db.deleteStockItem(req.params.id);
      log(req, 'DELETE_STOCK', `Hapus item stok ID: ${req.params.id}`);
      res.json({ success: true });
    });

    // ── ORDERS ────────────────────────────────────────────────
    r.get('/api/orders', (req, res) => {
      let orders = this.db.getAllOrders();
      if (req.query.status) orders = orders.filter(o=>o.status===req.query.status);
      res.json(orders.sort((a,b)=>b.created_at-a.created_at));
    });
    r.put('/api/orders/:id/confirm', async (req, res) => {
      try {
        const order = this.db.getOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const stockItem = this.db.getRandomStock(order.product_id);
        this.db.updateOrderStatus(order.id, 'delivered');
        if (stockItem) this.db.markStockSold(stockItem.id, order.id);
        const text = stockItem
          ? `✅ *Pembayaran Dikonfirmasi!*\n\n🔖 Order: \`${order.id}\`\n📦 *${order.product_name}*\n\n🎁 *Detail:*\n\`\`\`\n${stockItem.data}\n\`\`\`\n\n_Terima kasih! 🙏_`
          : `✅ *Dikonfirmasi!* Produk pre-order sedang diproses.`;
        await this.bot.bot.sendMessage(order.user_id, text, { parse_mode: 'Markdown' });
        this.db.recordSale(order);
        log(req, 'CONFIRM_ORDER', `Konfirmasi order ${order.id} - ${order.product_name} (@${order.username})`);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    r.put('/api/orders/:id/reject', async (req, res) => {
      try {
        const order = this.db.getOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        this.db.updateOrderStatus(order.id, 'cancelled');
        await this.bot.bot.sendMessage(order.user_id, `❌ *Pesanan Dibatalkan*\n\nOrder \`${order.id}\` untuk *${order.product_name}* dibatalkan.`, { parse_mode: 'Markdown' });
        log(req, 'REJECT_ORDER', `Tolak order ${order.id} - ${order.product_name} (@${order.username})`);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── TRIGGERS ──────────────────────────────────────────────
    r.get('/api/triggers', (_, res) => res.json(this.db.getTriggers()));
    r.post('/api/triggers', (req, res) => {
      this.db.addTrigger({ ...req.body, created_at: Date.now(), created_by: req.user.username });
      log(req, 'ADD_TRIGGER', `Tambah trigger: ${req.body.trigger}`);
      res.json({ success: true });
    });
    r.delete('/api/triggers/:trigger', (req, res) => {
      const t = decodeURIComponent(req.params.trigger);
      this.db.deleteTrigger(t);
      log(req, 'DELETE_TRIGGER', `Hapus trigger: ${t}`);
      res.json({ success: true });
    });

    // ── BROADCAST ─────────────────────────────────────────────
    r.post('/api/broadcast', async (req, res) => {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });
      const users = this.db.getAllUserIds();
      let sent = 0, failed = 0;
      for (const userId of users) {
        try { await this.bot.bot.sendMessage(userId, `📢 *Pengumuman*\n\n${message}`, { parse_mode: 'Markdown' }); sent++; await new Promise(r=>setTimeout(r,60)); }
        catch { failed++; }
      }
      log(req, 'BROADCAST', `Broadcast ke ${sent}/${users.length} user`);
      res.json({ success: true, sent, failed });
    });

    // ── USERS (telegram) ──────────────────────────────────────
    r.get('/api/users', (_, res) => res.json(this.db.getAllUsers()));

    // ── DASHBOARD USERS (admin only) ─────────────────────────
    r.get('/api/dashboard-users', adminOnly, (_, res) => {
      const users = this.db.getDashboardUsers().map(u => ({ ...u, password: undefined }));
      res.json(users);
    });
    r.post('/api/dashboard-users', adminOnly, (req, res) => {
      try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
        const user = this.db.createDashboardUser({ username, password, role: role||'member', created_by: req.user.username });
        log(req, 'CREATE_USER', `Buat user dashboard: ${username} (${role||'member'})`);
        res.json({ success: true, user: { ...user, password: undefined } });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
    r.put('/api/dashboard-users/:id', adminOnly, (req, res) => {
      try {
        const updates = { ...req.body };
        const user = this.db.updateDashboardUser(req.params.id, updates);
        log(req, 'EDIT_USER', `Edit user: ${user.username}`);
        res.json({ success: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
    r.delete('/api/dashboard-users/:id', adminOnly, (req, res) => {
      const u = this.db.getDashboardUserById(req.params.id);
      if (u?.username === req.user.username) return res.status(400).json({ error: 'Tidak bisa hapus akun sendiri' });
      this.db.deleteDashboardUser(req.params.id);
      log(req, 'DELETE_USER', `Hapus user: ${u?.username}`);
      res.json({ success: true });
    });

    // ── ACCESS LOGS ───────────────────────────────────────────
    r.get('/api/logs', adminOnly, (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      res.json(this.db.getLogs(limit));
    });

    // ── REPORT ────────────────────────────────────────────────
    r.get('/api/report/daily', (_, res) => res.json(this.db.getDailyReport()));

    // ── PAYMENT ───────────────────────────────────────────────
    r.get('/api/payment', (_, res) => res.json(this.db.getPaymentInfo()));
    r.put('/api/payment', (req, res) => {
      const existing = this.db.getPaymentInfo();
      this.db.setPaymentInfo(req.body.text, existing?.photo_file_id||null);
      log(req, 'EDIT_PAYMENT', 'Update info pembayaran');
      res.json({ success: true });
    });

    // ── SETTINGS ──────────────────────────────────────────────
    r.get('/api/settings', (_, res) => res.json(this.db.getSettings()));
    r.put('/api/settings', (req, res) => {
      this.db.setAutoOrder(req.body.auto_order);
      log(req, 'EDIT_SETTINGS', `Auto-order: ${req.body.auto_order}`);
      res.json({ success: true });
    });

    // ── ME (current user info) ─────────────────────────────────
    r.get('/api/auth/me', (req, res) => {
      res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
    });
  }

  start() {
    this.app.listen(this.port, () => console.log(`🌐 API Server running on port ${this.port}`));
  }
}

module.exports = APIServer;
