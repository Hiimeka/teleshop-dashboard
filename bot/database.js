const fs = require('fs');
const path = require('path');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '../database/db.json');
    this.ensure();
  }

  ensure() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({
        products: [], orders: [], stock: [], triggers: [],
        users: [], sales: [], payment_info: null,
        settings: { auto_order: false }
      }, null, 2));
    }
  }

  read() {
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
  }

  write(data) {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  // ── PRODUCTS ──
  getProducts() { return this.read().products.filter(p => p.active !== false); }
  getProductById(id) { return this.read().products.find(p => p.id === id); }
  findProduct(name) {
    const db = this.read();
    return db.products.find(p => p.name.toLowerCase() === name.toLowerCase() && p.active !== false);
  }
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

  // ── STOCK ──
  addStockItem(productId, data) {
    const db = this.read();
    db.stock.push({ id: Date.now().toString() + Math.random().toString(36).substr(2,5), product_id: productId, data, sold: false, order_id: null, added_at: Date.now() });
    this.write(db);
  }
  getStockCount(productId) {
    return this.read().stock.filter(s => s.product_id === productId && !s.sold).length;
  }
  getRandomStock(productId) {
    const available = this.read().stock.filter(s => s.product_id === productId && !s.sold);
    if (!available.length) return null;
    return available[Math.floor(Math.random() * available.length)];
  }
  markStockSold(stockId, orderId) {
    const db = this.read();
    const idx = db.stock.findIndex(s => s.id === stockId);
    if (idx !== -1) { db.stock[idx].sold = true; db.stock[idx].order_id = orderId; db.stock[idx].sold_at = Date.now(); this.write(db); }
  }
  getAllStock() { return this.read().stock; }
  deleteStockItem(stockId) {
    const db = this.read();
    db.stock = db.stock.filter(s => s.id !== stockId);
    this.write(db);
  }

  // ── ORDERS ──
  createOrder(order) {
    const db = this.read();
    db.orders.push(order);
    this.write(db);
  }
  getOrder(id) { return this.read().orders.find(o => o.id === id); }
  getPendingOrders() { return this.read().orders.filter(o => o.status === 'pending'); }
  getAllOrders() { return this.read().orders; }
  updateOrderStatus(id, status) {
    const db = this.read();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx !== -1) { db.orders[idx].status = status; db.orders[idx].updated_at = Date.now(); this.write(db); }
  }
  getPreOrdersByProduct(productId) {
    return this.read().orders.filter(o => o.product_id === productId && o.type === 'preorder' && o.status === 'preorder');
  }

  // ── TRIGGERS ──
  getTriggers() { return this.read().triggers; }
  getTrigger(trigger) { return this.read().triggers.find(t => t.trigger === trigger); }
  addTrigger(trigger) {
    const db = this.read();
    db.triggers = db.triggers.filter(t => t.trigger !== trigger.trigger);
    db.triggers.push(trigger);
    this.write(db);
  }
  deleteTrigger(trigger) {
    const db = this.read();
    db.triggers = db.triggers.filter(t => t.trigger !== trigger);
    this.write(db);
  }
  updateTriggerPhoto(trigger, photoFileId) {
    const db = this.read();
    const idx = db.triggers.findIndex(t => t.trigger === trigger);
    if (idx !== -1) { db.triggers[idx].photo_file_id = photoFileId; this.write(db); }
  }

  // ── USERS ──
  trackUser(userId, username) {
    const db = this.read();
    const existing = db.users.find(u => u.id === String(userId));
    if (!existing) {
      db.users.push({ id: String(userId), username, first_seen: Date.now(), last_seen: Date.now() });
    } else {
      existing.last_seen = Date.now();
      if (username) existing.username = username;
    }
    this.write(db);
  }
  getAllUserIds() { return this.read().users.map(u => u.id); }
  getAllUsers() { return this.read().users; }

  // ── PAYMENT INFO ──
  getPaymentInfo() { return this.read().payment_info; }
  setPaymentInfo(text, photoFileId) {
    const db = this.read();
    db.payment_info = { text, photo_file_id: photoFileId, updated_at: Date.now() };
    this.write(db);
  }

  // ── SALES & REPORTS ──
  recordSale(order) {
    const db = this.read();
    db.sales.push({ ...order, sold_at: Date.now() });
    this.write(db);
  }
  getDailyReport() {
    const db = this.read();
    const today = new Date(); today.setHours(0,0,0,0);
    const todayTs = today.getTime();
    const todayOrders = db.orders.filter(o => o.created_at >= todayTs);
    const todaySales = db.sales.filter(s => s.sold_at >= todayTs);
    const revenue = todaySales.reduce((sum, s) => sum + (s.price || 0), 0);
    const productCounts = {};
    todaySales.forEach(s => { productCounts[s.product_name] = (productCounts[s.product_name] || 0) + 1; });
    const top_products = Object.entries(productCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}));
    return {
      revenue,
      sold: todaySales.length,
      new_orders: todayOrders.length,
      cancelled: todayOrders.filter(o => o.status === 'cancelled').length,
      preorders: todayOrders.filter(o => o.type === 'preorder').length,
      top_products
    };
  }
  getRevenueChart(days = 7) {
    const db = this.read();
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      const nextD = new Date(d); nextD.setDate(nextD.getDate() + 1);
      const sales = db.sales.filter(s => s.sold_at >= d.getTime() && s.sold_at < nextD.getTime());
      result.push({ date: d.toISOString().split('T')[0], revenue: sales.reduce((s,o)=>s+(o.price||0),0), count: sales.length });
    }
    return result;
  }

  // ── SETTINGS ──
  setAutoOrder(val) {
    const db = this.read(); db.settings.auto_order = val; this.write(db);
  }
  getSettings() { return this.read().settings; }
}

module.exports = Database;
