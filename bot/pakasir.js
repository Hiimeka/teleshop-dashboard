const https = require('https');
const http  = require('http');

class Pakasir {
  constructor(project, apiKey) {
    this.project = project;
    this.apiKey  = apiKey;
    this.baseUrl = 'https://app.pakasir.com';
  }

  // ── Request helper ───────────────────────────────────────────
  async request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url  = new URL(this.baseUrl + path);
      const opts = {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method,
        headers:  { 'Content-Type': 'application/json' }
      };
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // ── Buat transaksi (default: QRIS) ──────────────────────────
  async createTransaction(orderId, amount, method = 'qris') {
    return this.request('POST', `/api/transactioncreate/${method}`, {
      project:  this.project,
      order_id: orderId,
      amount:   parseInt(amount),
      api_key:  this.apiKey
    });
  }

  // ── Cek status transaksi ─────────────────────────────────────
  async getTransaction(orderId, amount) {
    const qs = `?project=${this.project}&amount=${amount}&order_id=${orderId}&api_key=${this.apiKey}`;
    return this.request('GET', `/api/transactiondetail${qs}`);
  }

  // ── Batalkan transaksi ───────────────────────────────────────
  async cancelTransaction(orderId, amount) {
    return this.request('POST', '/api/transactioncancel', {
      project:  this.project,
      order_id: orderId,
      amount:   parseInt(amount),
      api_key:  this.apiKey
    });
  }

  // ── Buat URL pembayaran langsung (tanpa API) ─────────────────
  getPaymentUrl(orderId, amount, options = {}) {
    let url = `${this.baseUrl}/pay/${this.project}/${parseInt(amount)}?order_id=${orderId}`;
    if (options.redirect)  url += `&redirect=${encodeURIComponent(options.redirect)}`;
    if (options.qrisOnly)  url += `&qris_only=1`;
    return url;
  }

  // ── Verifikasi webhook ───────────────────────────────────────
  verifyWebhook(body) {
    return body &&
      body.project  === this.project &&
      body.status   === 'completed' &&
      body.order_id &&
      body.amount;
  }
}

module.exports = Pakasir;
