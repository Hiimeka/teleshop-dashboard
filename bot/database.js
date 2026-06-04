const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '../database/db.json');
    this.ensure();
  }

  ensure() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.dbPath)) {
      // Default admin account: admin / admin123
      const defaultAdmin = {
        id: 'usr_' + Date.now(),
        username: 'admin',
        password: this.hashPassword('admin123'),
        role: 'admin',
        created_at: Date.now(),
        created_by: 'system',
        active: true,
        last_login: null
      };
      fs.writeFileSync(this.dbPath, JSON.stringify({
        products: [], orders: [], stock: [], triggers: [],
        telegram_users: [], sales: [], payment_info: null,
        settings: { auto_order: false },
        dashboard_users: [defaultAdmin],
        access_logs: []
      }, null, 2));
      console.log('✅ Default admin dibuat: username=admin password=admin123');
    } else {
      // Migrate old db if needed
      const db = this.read();
      let changed = false;
      if (!db.dashboard_users) { db.dashboard_users = []; changed = true; }
      if (!db.access_logs)     { db.access_logs = [];     changed = true; }
      if (!db.telegram_users && db.users) { db.telegram_users = db.users; delete db.users; changed = true; }
      if (changed) this.write(db);
    }
  }

  read() { return JSON.parse(fs.readFileSync(this.dbPath, 'utf8')); }
  write(data) { fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2)); }

  hashPassword(plain) {
    return crypto.createHash('sha256').update(plain + 'shopbot_salt_2024').digest('hex');
  }

  // ── DASHBOARD USERS ──────────────────────────────────────────
  getDashboardUsers()   { return this.read().dashboard_users || []; }
  getDashboardUser(username) { return (this.read().dashboard_users || []).find(u => u.username === username); }
  getDashboardUserById(id)   { return (this.read().dashboard_users || []).find(u => u.id === id); }

  createDashboardUser({ username, password, role = 'member', created_by = 'system' }) {
    const db = this.read();
    if (!db.dashboard_users) db.dashboard_users = [];
    if (db.dashboard_users.find(u => u.username === username)) throw new Error('Username sudah dipakai');
    const user = {
      id: 'usr_' + Date.now() + Math.random().toString(36).substr(2,4),
      username,
      password: this.hashPassword(password),
      role,
      created_at: Date.now(),
      created_by,
      active: true,
      last_login: null
    };
    db.dashboard_users.push(user);
    this.write(db);
    return user;
  }

  updateDashboardUser(id, updates) {
    const db = this.read();
    const idx = db.dashboard_users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('User tidak ditemukan');
    if (updates.password) updates.password = this.hashPassword(updates.password);
    db.dashboard_users[idx] = { ...db.dashboard_users[idx], ...updates };
    this.write(db);
    return db.dashboard_users[idx];
  }

  deleteDashboardUser(id) {
    const db = this.read();
    db.dashboard_users = db.dashboard_users.filter(u => u.id !== id);
    this.write(db);
  }

  verifyPassword(username, plain) {
    const user = this.getDashboardUser(username);
    if (!user || !user.active) return null;
    if (user.password !== this.hashPassword(plain)) return null;
    // update last_login
    this.updateDashboardUser(user.id, { last_login: Date.now() });
    return user;
  }

  // ── ACCESS LOGS ──────────────────────────────────────────────
  addLog({ user_id, username, action, detail = '', ip = '' }) {
    const db = this.read();
    if (!db.access_logs) db.access_logs = [];
    db.access_logs.unshift({ id: Date.now().toString(), user_id, username, action, detail, ip, timestamp: Date.now() });
    // Keep last 500 logs
    if (db.access_logs.length > 500) db.access_logs = db.access_logs.slice(0, 500);
    this.write(db);
  }
  getLogs(limit = 100) { return (this.read().access_logs || []).slice(0, limit); }

  // ── PRODUCTS ─────────────────────────────────────────────────
  getProducts()        { return this.read().products.filter(p => p.active !== false); }
  getProductById(id)   { return this.read().products.find(p => p.id === id); }
  findProduct(name)    { return this.read().products.find(p => p.name.toLowerCase() === name.toLowerCase() && p.active !== false); }

  addProduct(product) {
    const db = this.read();
    db.products.push(product);
    this.write(db);
  }
  updateProduct(id, updates) {
    const db = this.read();
    const idx = db.products.findIndex(p => p.id === id);
    if (idx !== -1) { db.products[idx] = { ...db.products[idx], ...updates }; this.write(db); }
  }
  deleteProduct(id) {
    const db = this.read();
    db.products = db.products.map(p => p.id === id ? { ...p, active: false } : p);
    this.write(db);
  }

  // ── STOCK ─────────────────────────────────────────────────────
  addStockItem(productId, data) {
    const db = this.read();
    db.stock.push({ id: Date.now().toString() + Math.random().toString(36).substr(2,5), product_id: productId, data, sold: false, order_id: null, added_at: Date.now() });
    this.write(db);
  }
  getStockCount(productId) { return this.read().stock.filter(s => s.product_id === productId && !s.sold).length; }
  getRandomStock(productId) {
    const avail = this.read().stock.filter(s => s.product_id === productId && !s.sold);
    return avail.length ? avail[Math.floor(Math.random() * avail.length)] : null;
  }
  markStockSold(stockId, orderId) {
    const db = this.read();
    const idx = db.stock.findIndex(s => s.id === stockId);
    if (idx !== -1) { db.stock[idx].sold = true; db.stock[idx].order_id = orderId; db.stock[idx].sold_at = Date.now(); this.write(db); }
  }
  getAllStock()        { return this.read().stock; }
  deleteStockItem(id) { const db = this.read(); db.stock = db.stock.filter(s => s.id !== id); this.write(db); }

  // ── ORDERS ────────────────────────────────────────────────────
  createOrder(order)  { const db = this.read(); db.orders.push(order); this.write(db); }
  getOrder(id)        { return this.read().orders.find(o => o.id === id); }
  getPendingOrders()  { return this.read().orders.filter(o => o.status === 'pending'); }
  getAllOrders()       { return this.read().orders; }
  updateOrderStatus(id, status) {
    const db = this.read();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx !== -1) { db.orders[idx].status = status; db.orders[idx].updated_at = Date.now(); this.write(db); }
  }
  getPreOrdersByProduct(productId) { return this.read().orders.filter(o => o.product_id === productId && o.type === 'preorder' && o.status === 'preorder'); }

  // ── TRIGGERS ─────────────────────────────────────────────────
  getTriggers()   { return this.read().triggers; }
  getTrigger(t)   { return this.read().triggers.find(x => x.trigger === t); }
  addTrigger(trigger) {
    const db = this.read();
    db.triggers = db.triggers.filter(t => t.trigger !== trigger.trigger);
    db.triggers.push(trigger);
    this.write(db);
  }
  deleteTrigger(trigger) { const db = this.read(); db.triggers = db.triggers.filter(t => t.trigger !== trigger); this.write(db); }
  updateTriggerPhoto(trigger, photoFileId) {
    const db = this.read();
    const idx = db.triggers.findIndex(t => t.trigger === trigger);
    if (idx !== -1) { db.triggers[idx].photo_file_id = photoFileId; this.write(db); }
  }

  // ── TELEGRAM USERS ────────────────────────────────────────────
  trackUser(userId, username) {
    const db = this.read();
    if (!db.telegram_users) db.telegram_users = [];
    const existing = db.telegram_users.find(u => u.id === String(userId));
    if (!existing) db.telegram_users.push({ id: String(userId), username, first_seen: Date.now(), last_seen: Date.now() });
    else { existing.last_seen = Date.now(); if (username) existing.username = username; }
    this.write(db);
  }
  getAllUserIds() { return (this.read().telegram_users || []).map(u => u.id); }
  getAllUsers()   { return this.read().telegram_users || []; }

  // ── PAYMENT ───────────────────────────────────────────────────
  getPaymentInfo()           { return this.read().payment_info; }
  setPaymentInfo(text, photoFileId) {
    const db = this.read();
    db.payment_info = { text, photo_file_id: photoFileId, updated_at: Date.now() };
    this.write(db);
  }

  // ── SALES & REPORTS ───────────────────────────────────────────
  recordSale(order) { const db = this.read(); db.sales.push({ ...order, sold_at: Date.now() }); this.write(db); }
  getDailyReport() {
    const db    = this.read();
    const today = new Date(); today.setHours(0,0,0,0);
    const ts    = today.getTime();
    const todayOrders = db.orders.filter(o => o.created_at >= ts);
    const todaySales  = db.sales.filter(s => s.sold_at >= ts);
    const revenue     = todaySales.reduce((s,o) => s+(o.price||0), 0);
    const prodCounts  = {};
    todaySales.forEach(s => { prodCounts[s.product_name] = (prodCounts[s.product_name]||0)+1; });
    return {
      revenue, sold: todaySales.length,
      new_orders:  todayOrders.length,
      cancelled:   todayOrders.filter(o => o.status==='cancelled').length,
      preorders:   todayOrders.filter(o => o.type==='preorder').length,
      top_products: Object.entries(prodCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}))
    };
  }
  getRevenueChart(days=7) {
    const db = this.read();
    return Array.from({length:days},(_,i)=>{
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-(days-1-i));
      const nd = new Date(d); nd.setDate(nd.getDate()+1);
      const sales = db.sales.filter(s=>s.sold_at>=d.getTime()&&s.sold_at<nd.getTime());
      return { date: d.toISOString().split('T')[0], revenue: sales.reduce((s,o)=>s+(o.price||0),0), count: sales.length };
    });
  }

  // ── SETTINGS ─────────────────────────────────────────────────
  setAutoOrder(val) { const db=this.read(); db.settings.auto_order=val; this.write(db); }
  getSettings()     { return this.read().settings; }
  saveSettings(updates) { const db=this.read(); db.settings={...db.settings,...updates}; this.write(db); }
}

  // ── USER STATES (untuk flow tombol bot) ──────────────────────
  setUserState(userId, state) {
    const db = this.read();
    if (!db.user_states) db.user_states = {};
    db.user_states[String(userId)] = state;
    this.write(db);
  }
  getUserState(userId) {
    const db = this.read();
    return (db.user_states || {})[String(userId)] || null;
  }
  clearUserState(userId) {
    const db = this.read();
    if (!db.user_states) return;
    delete db.user_states[String(userId)];
    this.write(db);
  }
}

module.exports = Database;
