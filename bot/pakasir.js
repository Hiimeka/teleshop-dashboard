const https  = require('https');
const QRCode = require('qrcode');

class Pakasir {
  constructor(project, apiKey) {
    this.project = project;
    this.apiKey  = apiKey;
    this.baseUrl = 'https://app.pakasir.com';
  }

  // ── HTTP helper ──────────────────────────────────────────────
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

  // ── Create transaction ───────────────────────────────────────
  async createTransaction(orderId, amount, method = 'qris') {
    return this.request('POST', `/api/transactioncreate/${method}`, {
      project:  this.project,
      order_id: orderId,
      amount:   parseInt(amount),
      api_key:  this.apiKey
    });
  }

  // ── Generate QR sebagai Buffer PNG ───────────────────────────
  async createQrisBuffer(orderId, amount) {
    const result = await this.createTransaction(orderId, amount, 'qris');
    if (!result.payment || !result.payment.payment_number) {
      throw new Error(result.error || 'Gagal membuat transaksi QRIS');
    }
    const { payment } = result;
    // Konversi QR string → Buffer PNG
    const buffer = await QRCode.toBuffer(payment.payment_number, {
      type:             'png',
      width:            600,
      margin:           2,
      color:            { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'M'
    });
    return { buffer, payment };
  }

  // ── Create VA transaction ─────────────────────────────────────
  async createVATransaction(orderId, amount, vaMethod) {
    const result = await this.createTransaction(orderId, amount, vaMethod);
    if (!result.payment) throw new Error(result.error || 'Gagal membuat VA');
    return result.payment;
  }

  // ── Cek status ───────────────────────────────────────────────
  async getTransaction(orderId, amount) {
    const qs = `?project=${this.project}&amount=${amount}&order_id=${orderId}&api_key=${this.apiKey}`;
    return this.request('GET', `/api/transactiondetail${qs}`);
  }

  // ── Cancel ───────────────────────────────────────────────────
  async cancelTransaction(orderId, amount) {
    return this.request('POST', '/api/transactioncancel', {
      project:  this.project,
      order_id: orderId,
      amount:   parseInt(amount),
      api_key:  this.apiKey
    });
  }

  // ── URL langsung (fallback) ───────────────────────────────────
  getPaymentUrl(orderId, amount, options = {}) {
    let url = `${this.baseUrl}/pay/${this.project}/${parseInt(amount)}?order_id=${orderId}`;
    if (options.redirect) url += `&redirect=${encodeURIComponent(options.redirect)}`;
    if (options.qrisOnly) url += `&qris_only=1`;
    return url;
  }

  // ── Verifikasi webhook ────────────────────────────────────────
  verifyWebhook(body) {
    return body &&
      body.project  === this.project &&
      body.status   === 'completed' &&
      body.order_id &&
      body.amount;
  }
}

// Daftar metode VA yang tersedia
Pakasir.VA_METHODS = [
  { id: 'bri_va',         label: '🏦 BRI Virtual Account' },
  { id: 'bni_va',         label: '🏦 BNI Virtual Account' },
  { id: 'cimb_niaga_va',  label: '🏦 CIMB Niaga VA' },
  { id: 'permata_va',     label: '🏦 Permata VA' },
  { id: 'maybank_va',     label: '🏦 Maybank VA' },
  { id: 'bnc_va',         label: '🏦 BNC VA' },
  { id: 'sampoerna_va',   label: '🏦 Sampoerna VA' },
  { id: 'atm_bersama_va', label: '🏦 ATM Bersama VA' },
  { id: 'artha_graha_va', label: '🏦 Artha Graha VA' },
];

module.exports = Pakasir;
