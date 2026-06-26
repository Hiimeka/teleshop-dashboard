const express  = require('express');
const cors     = require('cors');
const Database = require('./database');
const Pakasir  = require('./pakasir');
const { generateToken, authMiddleware, adminOnly } = require('./auth');

class APIServer {
  constructor(bot) {
    this.app  = express();
    this.db   = bot.db;
    this.bot  = bot;
    this.port = parseInt(process.env.PORT) || 3000;
    this.pakasir = bot.pakasir || null;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // CORS - izinkan semua origin (Vercel, localhost, dll)
    this.app.use(cors({
      origin: '*',
      methods: ['GET','POST','PUT','DELETE','OPTIONS'],
      allowedHeaders: ['Content-Type','Authorization','x-api-key'],
    }));
    this.app.options('*', cors()); // handle preflight

    this.app.use(express.json({ limit: '10mb' }));

    // Log request
    this.app.use((req, res, next) => {
      if (req.path !== '/health') console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    const r = this.app;

    // ── PUBLIC ────────────────────────────────────────────────
    r.get('/health', (_, res) => {
      // Selalu return 200 — Railway butuh ini untuk health check
      res.status(200).json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        bot_ready: !!(this.bot && this.bot.bot),
        db_ready:  !!this.db,
        port: this.port,
        timestamp: new Date().toISOString()
      });
    });

    // Alias /healthz untuk kompatibilitas
    r.get('/healthz', (_, res) => res.status(200).send('OK'));
    r.get('/',        (_, res) => res.status(200).json({ service: 'ShopBot API', status: 'running' }));

    // ── PUBLIC STOCK CHECK (tidak butuh login, untuk halaman customer) ──
    // PENTING: hanya kirim data aman — nama, harga, jumlah stok.
    // TIDAK PERNAH kirim isi stok (akun/password) di endpoint publik ini.
    r.get('/api/public/stock', (_, res) => {
      try {
        const products = this.db.getProducts().map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          description: p.description || '',
          preorder_only: !!p.preorder_only,
          stock_count: this.db.getStockCount(p.id),
        }));
        res.json({ products, updated_at: new Date().toISOString() });
      } catch (e) {
        res.status(500).json({ error: 'Gagal memuat data stok' });
      }
    });

    // ── PUBLIC BOT INFO (untuk landing page — hanya username & url) ──
    r.get('/api/public/bot-info', async (_, res) => {
      try {
        if (!this.bot?.bot) return res.status(503).json({ error: 'Bot belum siap' });
        const me = await this.bot.bot.getMe();
        res.json({ username: me.username, url: `https://t.me/${me.username}` });
      } catch (e) {
        res.status(500).json({ error: 'Gagal memuat info bot' });
      }
    });

    // ── PAKASIR WEBHOOK (PUBLIC — tidak butuh auth) ────────────
    r.post('/webhook/pakasir', async (req, res) => {
      try {
        const body = req.body;
        console.log('[Webhook] Pakasir:', JSON.stringify(body));

        // Validasi basic
        if (!body || !body.order_id || !body.status || body.status !== 'completed') {
          return res.status(400).json({ error: 'Invalid webhook payload' });
        }

        const order = this.db.getOrder(body.order_id);
        if (!order) {
          console.warn('[Webhook] Order tidak ditemukan:', body.order_id);
          return res.json({ ok: true }); // tetap 200 agar Pakasir tidak retry
        }

        // Cek sudah diproses
        if (order.status === 'delivered') {
          console.log('[Webhook] Order sudah delivered:', body.order_id);
          return res.json({ ok: true });
        }

        // Verifikasi amount
        if (parseInt(body.amount) !== parseInt(order.price)) {
          console.warn('[Webhook] Amount tidak cocok:', body.amount, '!=', order.price);
          return res.json({ ok: true });
        }

        // Proses: kirim stok otomatis
        const stockItem = this.db.getRandomStock(order.product_id);
        this.db.updateOrderStatus(order.id, 'delivered');
        if (stockItem) this.db.markStockSold(stockItem.id, order.id);
        this.db.recordSale(order);
        this.db.addLog({
          user_id: 'system', username: 'pakasir-webhook',
          action: 'AUTO_CONFIRM',
          detail: `Auto-confirm via Pakasir webhook: ${order.id} - ${order.product_name}`
        });

        // Kirim stok ke user Telegram
        const deliveryText = stockItem
          ? `✅ *Pembayaran Diterima!*

🔖 \`${order.id}\`
📦 *${order.product_name}*

🎁 *Detail Produk:*
\`\`\`
${stockItem.data}
\`\`\`

_Terima kasih sudah berbelanja! 🙏_`
          : `✅ *Pembayaran Diterima!*

Produk sedang diproses oleh admin.`;

        try {
          await this.bot.bot.sendMessage(order.user_id, deliveryText, { parse_mode: 'Markdown' });
        } catch (e) {
          console.error('[Webhook] Gagal kirim pesan ke user:', e.message);
        }

        // Notif admin
        for (const adminId of this.bot.adminIds) {
          try {
            await this.bot.bot.sendMessage(adminId,
              `💰 *Pembayaran Masuk (Auto)!*
🔖 \`${order.id}\`
👤 @${order.username}
📦 ${order.product_name}
💰 Rp${parseInt(body.amount).toLocaleString('id-ID')}
✅ Stok terkirim otomatis via Pakasir`,
              { parse_mode: 'Markdown' }
            );
          } catch {}
        }

        console.log('[Webhook] ✅ Auto-confirm sukses:', order.id);
        res.json({ ok: true });
      } catch (e) {
        console.error('[Webhook] Error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

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
    // Guard: pastikan db sudah siap
    r.use((req, res, next) => {
      if (!this.db) return res.status(503).json({ error: 'Server masih starting, coba lagi dalam beberapa detik...' });
      next();
    });
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
    r.get('/api/stock', (req, res) => {
      let stock = this.db.getAllStock();
      // Filter by product_id jika ada query param
      if (req.query.product_id) stock = stock.filter(s => s.product_id === req.query.product_id);
      // Filter by status
      if (req.query.status === 'available') stock = stock.filter(s => !s.sold);
      if (req.query.status === 'sold')      stock = stock.filter(s => s.sold);
      res.json(stock);
    });
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
        const noteInfo = order.note ? ` | Catatan: ${order.note}` : '';
        log(req, 'CONFIRM_ORDER', `Konfirmasi order ${order.id} - ${order.product_name} (@${order.username})${noteInfo}`);
        res.json({ success: true, note: order.note || null });
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
      if (!message || !message.trim()) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
      if (!this.bot?.bot) return res.status(503).json({ error: 'Bot Telegram belum siap, coba lagi sebentar' });

      const users = this.db.getAllUserIds();
      if (!users.length) return res.status(400).json({ error: 'Belum ada user yang pernah chat bot' });

      let sent = 0, failed = 0;
      const errors = [];

      for (const userId of users) {
        try {
          await this.bot.bot.sendMessage(userId, `📢 *Pengumuman*\n\n${message}`, { parse_mode: 'Markdown' });
          sent++;
        } catch (e) {
          failed++;
          // Catat alasan gagal — biasanya user blokir bot atau chat tidak ditemukan
          const reason = e?.response?.body?.description || e.message || 'Unknown error';
          errors.push({ userId, reason });
          console.error(`[Broadcast] Gagal kirim ke ${userId}:`, reason);
        }
        await new Promise(r => setTimeout(r, 60));
      }

      log(req, 'BROADCAST', `Broadcast ke ${sent}/${users.length} user (${failed} gagal)`);
      res.json({
        success: true,
        sent,
        failed,
        total: users.length,
        errors: errors.slice(0, 10) // kirim 10 contoh error pertama untuk debug
      });
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

    // ── GREETING (custom welcome message) ──────────────────────
    r.get('/api/greeting', (_, res) => res.json(this.db.getGreeting()));
    r.put('/api/greeting', (req, res) => {
      const { text } = req.body;
      if (!text || !text.trim()) return res.status(400).json({ error: 'Teks greeting wajib diisi' });
      this.db.setGreeting(text.trim());
      log(req, 'EDIT_GREETING', 'Update custom greeting');
      res.json({ success: true });
    });
    r.delete('/api/greeting', (req, res) => {
      this.db.clearGreeting();
      log(req, 'EDIT_GREETING', 'Reset greeting ke default');
      res.json({ success: true });
    });

    // ── SETTINGS ──────────────────────────────────────────────
    r.get('/api/settings', (_, res) => res.json(this.db.getSettings()));
    r.put('/api/settings', (req, res) => {
      const db_settings = this.db.getSettings();
      const updates = { ...db_settings, ...req.body };
      this.db.saveSettings(updates);
      log(req, 'EDIT_SETTINGS', `Update settings`);
      res.json({ success: true });
    });

    // ── PAKASIR: create transaction ──────────────────────────
    r.post('/api/pakasir/create', async (req, res) => {
      if (!this.pakasir) return res.status(400).json({ error: 'Pakasir tidak dikonfigurasi' });
      const { order_id, amount, method } = req.body;
      if (!order_id || !amount) return res.status(400).json({ error: 'order_id dan amount wajib' });
      try {
        const result = await this.pakasir.createTransaction(order_id, amount, method || 'qris');
        log(req, 'PAKASIR_CREATE', `Create transaction: ${order_id} - Rp${amount}`);
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    r.get('/api/pakasir/status', async (req, res) => {
      if (!this.pakasir) return res.status(400).json({ error: 'Pakasir tidak dikonfigurasi' });
      const { order_id, amount } = req.query;
      if (!order_id || !amount) return res.status(400).json({ error: 'order_id dan amount wajib' });
      try {
        const result = await this.pakasir.getTransaction(order_id, amount);
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    r.post('/api/pakasir/cancel', async (req, res) => {
      if (!this.pakasir) return res.status(400).json({ error: 'Pakasir tidak dikonfigurasi' });
      const { order_id, amount } = req.body;
      try {
        const result = await this.pakasir.cancelTransaction(order_id, amount);
        log(req, 'PAKASIR_CANCEL', `Cancel transaction: ${order_id}`);
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    r.get('/api/pakasir/info', (_, res) => {
      res.json({
        active:   !!this.pakasir,
        project:  process.env.PAKASIR_PROJECT || null,
        webhook:  process.env.APP_URL ? process.env.APP_URL + '/webhook/pakasir' : 'Set APP_URL di .env'
      });
    });

    // ── BOT INFO (username & redirect link) ───────────────────
    r.get('/api/bot-info', async (_, res) => {
      try {
        const me = await this.bot.bot.getMe();
        res.json({ username: me.username, url: `https://t.me/${me.username}` });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── ME (current user info) ─────────────────────────────────
    r.get('/api/auth/me', (req, res) => {
      res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
    });
  }

  start() {
    this.app.listen(this.port, '0.0.0.0', () => {
      // Railway mendeteksi sinyal ini untuk tahu app sudah jalan
      console.log(`✅ Server started successfully`);
      console.log(`🌐 API Server running on port ${this.port}`);
      console.log(`🔗 Health check: http://0.0.0.0:${this.port}/health`);
    });
  }
}

module.exports = APIServer;
