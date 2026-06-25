const TelegramBot = require('node-telegram-bot-api');
const Database    = require('./database');
const Pakasir     = require('./pakasir');
const { formatCurrency, generateOrderId } = require('./utils');

class ShopBot {
  constructor(token, adminIds) {
    this.bot      = new TelegramBot(token, { polling: true });
    this.db       = new Database();
    this.adminIds = adminIds.map(String);

    // Init Pakasir jika env tersedia
    if (process.env.PAKASIR_PROJECT && process.env.PAKASIR_API_KEY) {
      this.pakasir = new Pakasir(process.env.PAKASIR_PROJECT, process.env.PAKASIR_API_KEY);
      console.log('💳 Pakasir payment gateway aktif');
    } else {
      this.pakasir = null;
      console.log('⚠️  Pakasir tidak dikonfigurasi (PAKASIR_PROJECT / PAKASIR_API_KEY kosong)');
    }

    this.setupHandlers();
    this.scheduleDailyReport();
    console.log('🤖 Bot started successfully!');
  }

  isAdmin(userId) { return this.adminIds.includes(String(userId)); }

  // ── Kirim menu utama dengan tombol ──────────────────────────
  async sendMainMenu(chatId, name) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🛍️ Lihat Produk', callback_data: 'menu_products' }],
        [{ text: '📦 Cek Stok Real-time', callback_data: 'menu_stock_check' }],
        [{ text: '💳 Info Pembayaran', callback_data: 'menu_pay' }],
        [{ text: '📋 Cek Status Pesanan', callback_data: 'menu_status_ask' }],
        [{ text: '❓ Bantuan', callback_data: 'menu_help' }],
      ]
    };

    // Custom greeting dari dashboard, atau default
    const customGreeting = this.db.getGreeting();
    let greetingText;
    if (customGreeting?.text) {
      // Support placeholder {name} di greeting custom
      greetingText = customGreeting.text.replace(/\{name\}/g, name);
    } else {
      greetingText = `👋 Halo *${name}*! Selamat datang.`;
    }

    await this.bot.sendMessage(chatId,
      `${greetingText}\n\nPilih menu di bawah:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }

  // ── Kirim link halaman stok publik (real-time) ────────────────
  async sendStockCheckLink(chatId, msgId) {
    const stockUrl = process.env.STOCK_PAGE_URL;
    const keyboard = { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu_main' }]] };

    if (!stockUrl) {
      const text = '⚠️ Halaman cek stok belum diatur admin.\n\n_Hubungi admin untuk info stok terbaru._';
      if (msgId) return this.bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: keyboard });
      return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

    const text = '📦 *Cek Stok Real-time*\n\nKlik tombol di bawah untuk melihat stok semua produk secara langsung — update otomatis tanpa perlu chat admin.';
    const linkKeyboard = {
      inline_keyboard: [
        [{ text: '🔗 Buka Halaman Stok', url: stockUrl }],
        [{ text: '🔙 Menu Utama', callback_data: 'menu_main' }],
      ]
    };
    if (msgId) return this.bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: linkKeyboard });
    return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: linkKeyboard });
  }

  // ── Kirim daftar kategori produk ─────────────────────────────
  async sendProductCategories(chatId) {
    const products = this.db.getProducts();
    if (!products.length) return this.bot.sendMessage(chatId, '📭 Belum ada produk tersedia.');

    // Buat tombol per produk
    const buttons = products.map(p => {
      const stock = this.db.getStockCount(p.id);
      const label = p.preorder_only
        ? `📋 ${p.name} - ${formatCurrency(p.price)} (Pre-Order)`
        : stock > 0
          ? `✅ ${p.name} - ${formatCurrency(p.price)}`
          : `❌ ${p.name} - ${formatCurrency(p.price)} (Habis)`;
      return [{ text: label, callback_data: `product_${p.id}` }];
    });
    buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu_main' }]);

    await this.bot.sendMessage(chatId,
      '🛍️ *Pilih Produk:*',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
  }

  // ── Detail produk + tombol order ────────────────────────────
  async sendProductDetail(chatId, productId, fromId) {
    const p     = this.db.getProductById(productId);
    if (!p) return;
    const stock = this.db.getStockCount(p.id);
    let text    = `📦 *${p.name}*\n`;
    if (p.description) text += `\n📝 ${p.description}\n`;
    text += `\n💰 Harga: *${formatCurrency(p.price)}*\n`;
    text += p.preorder_only
      ? `📋 Status: Pre-Order\n`
      : `📦 Stok: ${stock > 0 ? `${stock} tersedia` : '❌ Habis'}\n`;

    const buttons = [];
    if (p.preorder_only || stock > 0) {
      buttons.push([{ text: `🛒 Pesan Sekarang`, callback_data: `order_${p.id}` }]);
    } else {
      buttons.push([{ text: `📋 Pre-Order`, callback_data: `preorder_${p.id}` }]);
    }
    buttons.push([{ text: '🔙 Kembali ke Produk', callback_data: 'menu_products' }]);

    await this.bot.sendMessage(chatId, text,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
  }

  setupHandlers() {
    // /start → langsung menu tombol
    this.bot.onText(/^\/start$/, (msg) => {
      const name = msg.from.first_name || 'Pembeli';
      this.db.trackUser(msg.from.id, msg.from.username);
      this.sendMainMenu(msg.chat.id, name);
    });

    // Admin commands tetap pakai text
    this.bot.onText(/^\/addstock (.+)$/, (msg, match) => this.handleAddStock(msg, match[1]));
    this.bot.onText(/^\/addproduct (.+)$/, (msg, match) => this.handleAddProduct(msg, match[1]));
    this.bot.onText(/^\/confirm (.+)$/, (msg, match) => this.handleConfirmPayment(msg, match[1]));
    this.bot.onText(/^\/rejectorder (.+)$/, (msg, match) => this.handleRejectOrder(msg, match[1]));
    this.bot.onText(/^\/orders$/, (msg) => this.handleListOrders(msg));
    this.bot.onText(/^\/stocklist$/, (msg) => this.handleStockList(msg));
    this.bot.onText(/^\/broadcast (.+)$/, (msg, match) => this.handleBroadcast(msg, match[1]));
    this.bot.onText(/^\/report$/, (msg) => this.handleDailyReport(msg));
    this.bot.onText(/^\/autoorder (.+)$/, (msg, match) => this.handleAutoOrder(msg, match[1]));
    this.bot.onText(/^\/addtrigger (.+)$/, (msg, match) => this.handleAddTrigger(msg, match[1]));
    this.bot.onText(/^\/deltrigger (.+)$/, (msg, match) => this.handleDelTrigger(msg, match[1]));
    this.bot.onText(/^\/triggers$/, (msg) => this.handleListTriggers(msg));
    this.bot.onText(/^\/hidetag(.*)$/, (msg, match) => this.handleHideTag(msg, match[1]?.trim()));

    // Dynamic triggers
    this.bot.on('message', (msg) => this.handleDynamicTriggers(msg));

    // Photo upload (admin)
    this.bot.on('photo', (msg) => this.handlePhotoUpload(msg));

    // Semua interaksi user via callback_query (tombol)
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));
  }

  // ════════════════ CALLBACK QUERY (tombol inline) ════════════
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const data   = query.data;
    const userId = query.from.id;

    await this.bot.answerCallbackQuery(query.id);
    this.db.trackUser(userId, query.from.username);

    // ── Menu utama ──
    if (data === 'menu_main') {
      const name = query.from.first_name || 'Pembeli';
      const customGreeting = this.db.getGreeting();
      const greetingText = customGreeting?.text
        ? customGreeting.text.replace(/\{name\}/g, name)
        : `👋 Halo *${name}*!`;

      await this.bot.editMessageText(`${greetingText}\n\nPilih menu di bawah:`, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🛍️ Lihat Produk', callback_data: 'menu_products' }],
          [{ text: '📦 Cek Stok Real-time', callback_data: 'menu_stock_check' }],
          [{ text: '💳 Info Pembayaran', callback_data: 'menu_pay' }],
          [{ text: '📋 Cek Status Pesanan', callback_data: 'menu_status_ask' }],
          [{ text: '❓ Bantuan', callback_data: 'menu_help' }],
        ]}
      });
    }

    // ── Cek stok real-time (redirect ke website) ──
    else if (data === 'menu_stock_check') {
      await this.sendStockCheckLink(chatId, msgId);
    }

    // ── Daftar produk ──
    else if (data === 'menu_products') {
      const products = this.db.getProducts();
      if (!products.length) {
        return this.bot.editMessageText('📭 Belum ada produk.', { chat_id: chatId, message_id: msgId });
      }
      const buttons = products.map(p => {
        const stock = this.db.getStockCount(p.id);
        const label = p.preorder_only
          ? `📋 ${p.name} - ${formatCurrency(p.price)}`
          : stock > 0
            ? `✅ ${p.name} - ${formatCurrency(p.price)}`
            : `❌ ${p.name} - ${formatCurrency(p.price)} (Habis)`;
        return [{ text: label, callback_data: `product_${p.id}` }];
      });
      buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu_main' }]);
      await this.bot.editMessageText('🛍️ *Pilih Produk:*', {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    // ── Detail produk ──
    else if (data.startsWith('product_')) {
      const productId = data.replace('product_', '');
      const p         = this.db.getProductById(productId);
      if (!p) return;
      const stock = this.db.getStockCount(p.id);
      let text    = `📦 *${p.name}*\n`;
      if (p.description) text += `\n📝 ${p.description}\n`;
      text += `\n💰 Harga: *${formatCurrency(p.price)}*\n`;
      text += p.preorder_only ? `📋 Status: Pre-Order\n` : `📦 Stok: ${stock > 0 ? `${stock} tersedia` : '❌ Habis'}\n`;

      const btns = [];
      if (p.preorder_only || stock > 0) {
        btns.push([{ text: `🛒 Pesan Sekarang`, callback_data: `order_${p.id}` }]);
      } else {
        btns.push([{ text: `📋 Pre-Order`, callback_data: `preorder_${p.id}` }]);
      }
      btns.push([{ text: '🔙 Kembali', callback_data: 'menu_products' }]);
      await this.bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: btns }
      });
    }

    // ── Buat order (tanya catatan dulu) ──
    else if (data.startsWith('order_')) {
      const productId = data.replace('order_', '');
      const p         = this.db.getProductById(productId);
      if (!p) return;
      const stock = this.db.getStockCount(p.id);
      if (!p.preorder_only && stock === 0) {
        await this.bot.editMessageText(`❌ Stok *${p.name}* habis!\n\nMau pre-order?`, {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '📋 Pre-Order', callback_data: `preorder_${p.id}` }],
            [{ text: '🔙 Kembali', callback_data: 'menu_products' }]
          ]}
        });
        return;
      }

      // Tanya dulu apakah ada catatan khusus
      await this.bot.editMessageText(
        `📝 *Catatan untuk Pesanan*\n\n📦 *${p.name}*\n💰 *${formatCurrency(p.price)}*\n\nApakah ada permintaan khusus? (misal: warna tertentu, akun lama, dll)\n\nKetik catatan kamu, atau lewati jika tidak ada.`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '⏭️ Lewati / Tidak Ada Catatan', callback_data: `skipnote_${productId}` }],
            [{ text: '🔙 Batal', callback_data: 'menu_products' }],
          ]}
        }
      );
      // Set state agar pesan teks berikutnya dianggap sebagai catatan
      this.db.setUserState(userId, `waiting_note_${productId}`);
    }

    // ── Lewati catatan, langsung buat order ──
    else if (data.startsWith('skipnote_')) {
      const productId = data.replace('skipnote_', '');
      this.db.clearUserState(userId);
      await this.createOrderAndShowPayment(chatId, msgId, userId, query.from, productId, null);
    }

    // ── Pilih metode pembayaran ──
    else if (data.startsWith('paymethod_')) {
      // format: paymethod_ORDERID_METHOD
      const parts  = data.replace('paymethod_', '').split('_');
      const method = parts.pop();   // ambil method dari belakang
      const orderId = parts.join('_');
      const order  = this.db.getOrder(orderId);
      if (!order || !this.pakasir) return;

      await this.bot.answerCallbackQuery(query.id, { text: '⏳ Membuat pembayaran...' });

      if (method === 'qris') {
        await this.sendQrisPayment(chatId, msgId, orderId, order);
      } else {
        await this.sendVAPayment(chatId, msgId, orderId, order, method);
      }
    }

    // ── Pre-order ──
    else if (data.startsWith('preorder_')) {
      const productId = data.replace('preorder_', '');
      const p         = this.db.getProductById(productId);
      if (!p) return;
      const orderId = generateOrderId();
      this.db.createOrder({
        id: orderId, user_id: userId,
        username: query.from.username || query.from.first_name,
        product_id: p.id, product_name: p.name, price: p.price,
        status: 'preorder', type: 'preorder', created_at: Date.now()
      });
      await this.bot.editMessageText(
        `📋 *Pre-Order Berhasil!*\n\n🔖 Order ID: \`${orderId}\`\n📦 ${p.name}\n💰 ${formatCurrency(p.price)}\n\nKami akan hubungi kamu saat stok tersedia.`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu_main' }]]} }
      );
      for (const adminId of this.adminIds) {
        await this.bot.sendMessage(adminId, `📋 *Pre-Order Baru!*\n👤 @${query.from.username||query.from.first_name}\n📦 ${p.name}\n🔖 ${orderId}`, { parse_mode: 'Markdown' });
      }
    }

    // ── Tampilkan info bayar ──
    else if (data.startsWith('show_pay_')) {
      const orderId = data.replace('show_pay_', '');
      const order   = this.db.getOrder(orderId);
      if (!order) return;
      const payInfo = this.db.getPaymentInfo();
      const text    = payInfo
        ? `💳 *Cara Pembayaran*\n\n${payInfo.text}\n\n💰 Jumlah: *${formatCurrency(order.price)}*\n🔖 Order: \`${orderId}\`\n\n_Kirim bukti ke admin setelah transfer._`
        : `💰 Total: *${formatCurrency(order.price)}*\n🔖 Order: \`${orderId}\`\n\n_Hubungi admin untuk info pembayaran._`;
      if (payInfo?.photo_file_id) {
        await this.bot.sendPhoto(chatId, payInfo.photo_file_id, {
          caption: text, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: `status_${orderId}` }, { text: '🔙 Menu', callback_data: 'menu_main' }]] }
        });
      } else {
        await this.bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: `status_${orderId}` }, { text: '🔙 Menu', callback_data: 'menu_main' }]] }
        });
      }
    }

    // ── Cek status ──
    else if (data.startsWith('status_')) {
      const orderId = data.replace('status_', '');
      const order   = this.db.getOrder(orderId);
      if (!order) return this.bot.sendMessage(chatId, '❌ Order tidak ditemukan.');
      const emj = { pending:'⏳', paid:'✅', delivered:'📬', cancelled:'❌', preorder:'📋' };
      await this.bot.sendMessage(chatId,
        `📋 *Status Pesanan*\n\n🔖 \`${order.id}\`\n📦 ${order.product_name}\n💰 ${formatCurrency(order.price)}\n${emj[order.status]||'📌'} Status: *${order.status.toUpperCase()}*\n📅 ${new Date(order.created_at).toLocaleString('id-ID')}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu_main' }]] } }
      );
    }

    // ── Minta input order ID untuk status ──
    else if (data === 'menu_status_ask') {
      await this.bot.editMessageText(
        '📋 *Cek Status Pesanan*\n\nKirim Order ID kamu (contoh: ORD-ABCD1234)',
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Batal', callback_data: 'menu_main' }]] } }
      );
      // Set state tunggu order ID
      this.db.setUserState(userId, 'waiting_order_id');
    }

    // ── Info pembayaran ──
    else if (data === 'menu_pay') {
      const payInfo = this.db.getPaymentInfo();
      if (!payInfo) {
        await this.bot.editMessageText('⚠️ Info pembayaran belum diatur admin.',
          { chat_id: chatId, message_id: msgId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu_main' }]] } }
        );
        return;
      }
      if (payInfo.photo_file_id) {
        await this.bot.sendPhoto(chatId, payInfo.photo_file_id, {
          caption: `💳 *Info Pembayaran*\n\n${payInfo.text}`, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu_main' }]] }
        });
      } else {
        await this.bot.editMessageText(`💳 *Info Pembayaran*\n\n${payInfo.text}`, {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu_main' }]] }
        });
      }
    }

    // ── Bantuan ──
    else if (data === 'menu_help') {
      await this.bot.editMessageText(
        `❓ *Bantuan*\n\n🛍️ *Lihat Produk* — Browsing & order produk\n📦 *Cek Stok Real-time* — Lihat stok terbaru lewat website\n💳 *Info Pembayaran* — Cara dan rekening pembayaran\n📋 *Cek Status* — Status pesanan kamu\n\n_Tekan /start untuk kembali ke menu utama_`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu_main' }]] } }
      );
    }

    // ── Cek status pembayaran Pakasir ──
    else if (data.startsWith('cek_pay_')) {
      const orderId = data.replace('cek_pay_', '');
      const order   = this.db.getOrder(orderId);
      if (!order) return;

      if (this.pakasir) {
        try {
          const result = await this.pakasir.getTransaction(orderId, order.price);
          const tx     = result.transaction;
          if (tx && tx.status === 'completed') {
            // Pembayaran lunas — kirim stok otomatis
            if (order.status !== 'delivered') {
              const stockItem = this.db.getRandomStock(order.product_id);
              this.db.updateOrderStatus(order.id, 'delivered');
              if (stockItem) this.db.markStockSold(stockItem.id, order.id);
              this.db.recordSale(order);
              const deliveryText = stockItem
                ? `✅ *Pembayaran Diterima!*\n\n🔖 \`${order.id}\`\n📦 *${order.product_name}*\n\n🎁 *Detail Produk:*\n\`\`\`\n${stockItem.data}\n\`\`\`\n\n_Terima kasih! 🙏_`
                : `✅ *Pembayaran Diterima!* Produk sedang diproses.`;
              await this.bot.editMessageText(deliveryText, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'menu_main' }]] }
              });
              for (const adminId of this.adminIds) {
                await this.bot.sendMessage(adminId,
                  `💰 *Pembayaran Masuk!*\n🔖 \`${order.id}\`\n👤 @${order.username}\n📦 ${order.product_name}\n💰 ${formatCurrency(order.price)}\n✅ Stok terkirim otomatis`,
                  { parse_mode: 'Markdown' }
                );
              }
            } else {
              await this.bot.answerCallbackQuery(query.id, { text: '✅ Pembayaran sudah diproses!' });
            }
          } else {
            // Belum lunas
            const payUrl = this.pakasir.getPaymentUrl(orderId, order.price, { qrisOnly: false });
            await this.bot.editMessageText(
              `⏳ *Pembayaran Belum Diterima*\n\n🔖 \`${orderId}\`\n💰 ${formatCurrency(order.price)}\n\nSilakan selesaikan pembayaran terlebih dahulu.`,
              { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                  [{ text: '💳 Bayar Sekarang', url: payUrl }],
                  [{ text: '🔄 Cek Lagi', callback_data: `cek_pay_${orderId}` }],
                  [{ text: '❌ Batalkan', callback_data: `cancel_order_${orderId}` }],
                ]}
              }
            );
          }
        } catch (e) {
          await this.bot.answerCallbackQuery(query.id, { text: '⚠️ Gagal cek status, coba lagi.' });
        }
      } else {
        await this.bot.answerCallbackQuery(query.id, { text: 'Payment gateway tidak aktif.' });
      }
    }

    // ── Kembali ke pilih metode ──
    else if (data.startsWith('paymethod_back_')) {
      const orderId = data.replace('paymethod_back_', '');
      const order   = this.db.getOrder(orderId);
      if (!order) return;
      const p = this.db.getProductById(order.product_id);
      if (!p) return;
      await this.sendPaymentMethodMenu(chatId, msgId, orderId, p);
    }

    // ── Cancel order ──
    else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');
      const order   = this.db.getOrder(orderId);

      // Konfirmasi dulu sebelum batalkan
      if (!order) {
        return this.bot.editMessageText(
          `❌ Order tidak ditemukan.`,
          { chat_id: chatId, message_id: msgId,
            reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'menu_main' }]] } }
        );
      }

      // Jika sudah delivered, tidak bisa dibatalkan
      if (order.status === 'delivered') {
        return this.bot.editMessageText(
          `⚠️ *Pesanan sudah selesai*\n\nOrder \`${orderId}\` sudah dikirim dan tidak bisa dibatalkan.`,
          { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'menu_main' }]] } }
        );
      }

      // Batalkan & cancel transaksi Pakasir jika ada
      this.db.updateOrderStatus(orderId, 'cancelled');
      if (this.pakasir) {
        try { await this.pakasir.cancelTransaction(orderId, order.price); } catch {}
      }

      // Notif admin
      for (const adminId of this.adminIds) {
        try {
          await this.bot.sendMessage(adminId,
            `❌ *Pesanan Dibatalkan*\n👤 @${order.username}\n🔖 \`${orderId}\`\n📦 ${order.product_name}\n💰 ${formatCurrency(order.price)}`,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }

      // Tampilkan konfirmasi ke user + tombol kembali ke menu
      await this.bot.editMessageText(
        `❌ *Pesanan Dibatalkan*\n\n` +
        `🔖 Order: \`${orderId}\`\n` +
        `📦 ${order.product_name}\n` +
        `💰 ${formatCurrency(order.price)}\n\n` +
        `_Pesanan kamu telah berhasil dibatalkan._\n` +
        `_Jika ini kesalahan, silakan pesan ulang._`,
        {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '🛍️ Pesan Lagi', callback_data: 'menu_products' }],
            [{ text: '🏠 Menu Utama', callback_data: 'menu_main' }],
          ]}
        }
      );
    }
  }

  // ════════════════ PAYMENT HELPERS ══════════════════════════

  // Buat order (dengan/tanpa catatan) lalu lanjut ke pembayaran
  // msgId null = kirim pesan baru (dipakai saat user reply teks catatan)
  async createOrderAndShowPayment(chatId, msgId, userId, fromUser, productId, note) {
    const p = this.db.getProductById(productId);
    if (!p) return;

    const orderId = generateOrderId();
    this.db.createOrder({
      id: orderId, user_id: userId,
      username: fromUser.username || fromUser.first_name,
      product_id: p.id, product_name: p.name, price: p.price,
      status: 'pending', type: p.preorder_only ? 'preorder' : 'normal',
      note: note || null,
      created_at: Date.now()
    });

    if (this.pakasir) {
      await this.sendPaymentMethodMenu(chatId, msgId, orderId, p, note);
    } else {
      const noteText = note ? `\n📝 Catatan: _${note}_\n` : '';
      const text = `✅ *Pesanan Dibuat!*\n\n🔖 Order ID: \`${orderId}\`\n📦 *${p.name}*\n💰 *${formatCurrency(p.price)}*${noteText}\n📊 Menunggu Pembayaran`;
      const opts = { parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '💳 Info Pembayaran', callback_data: `show_pay_${orderId}` }],
          [{ text: '❌ Batalkan Order', callback_data: `cancel_order_${orderId}` }],
        ]}
      };
      if (msgId) await this.bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts });
      else await this.bot.sendMessage(chatId, text, opts);
    }

    // Notif admin — sertakan catatan jika ada
    const noteForAdmin = note ? `\n📝 *Catatan:* ${note}` : '';
    for (const adminId of this.adminIds) {
      await this.bot.sendMessage(adminId,
        `🆕 *Pesanan Baru!*\n👤 @${fromUser.username || fromUser.first_name} (${userId})\n🔖 \`${orderId}\`\n📦 ${p.name}\n💰 ${formatCurrency(p.price)}\n💳 ${this.pakasir ? 'Pakasir (pilih metode)' : 'Manual'}${noteForAdmin}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // Tampilkan menu pilih metode bayar
  async sendPaymentMethodMenu(chatId, msgId, orderId, product, note) {
    const Pakasir = require('./pakasir');
    const vaButtons = Pakasir.VA_METHODS.map(va => ([{
      text: va.label,
      callback_data: `paymethod_${orderId}_${va.id}`
    }]));

    const keyboard = [
      [{ text: '📱 QRIS (Scan QR Code)', callback_data: `paymethod_${orderId}_qris` }],
      ...vaButtons,
      [{ text: '❌ Batalkan Order', callback_data: `cancel_order_${orderId}` }],
    ];

    const noteText = note ? `\n📝 Catatan: _${note}_\n` : '';
    const text = `✅ *Pesanan Dibuat!*\n\n` +
      `🔖 Order ID: \`${orderId}\`\n` +
      `📦 *${product.name}*\n` +
      `💰 *${formatCurrency(product.price)}*${noteText}\n` +
      `💳 *Pilih metode pembayaran:*`;
    const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };

    if (msgId) await this.bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts });
    else await this.bot.sendMessage(chatId, text, opts);
  }

  // Kirim QR QRIS langsung di bot
  async sendQrisPayment(chatId, msgId, orderId, order) {
    try {
      // Edit pesan jadi loading
      await this.bot.editMessageText(
        `⏳ *Membuat QR QRIS...*\n\n🔖 \`${orderId}\`\n💰 ${formatCurrency(order.price)}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );

      const { buffer, payment } = await this.pakasir.createQrisBuffer(orderId, order.price);

      // Hitung expired
      const expiredAt = new Date(payment.expired_at);
      const expStr    = expiredAt.toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

      const caption =
        `💳 *Pembayaran QRIS*\n\n` +
        `🔖 Order: \`${orderId}\`\n` +
        `📦 ${order.product_name}\n` +
        `💰 Total: *${formatCurrency(payment.total_payment || order.price)}*\n` +
        `⏰ Berlaku sampai: ${expStr}\n\n` +
        `_Scan QR di atas menggunakan aplikasi apapun yang support QRIS_`;

      // Hapus pesan lama, kirim foto QR baru
      try { await this.bot.deleteMessage(chatId, msgId); } catch {}

      await this.bot.sendPhoto(chatId, buffer, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Saya Sudah Bayar', callback_data: `cek_pay_${orderId}` }],
          [{ text: '🔄 Ganti Metode Bayar', callback_data: `order_${order.product_id}` }],
          [{ text: '❌ Batalkan', callback_data: `cancel_order_${orderId}` }],
        ]}
      });

    } catch (e) {
      console.error('QRIS error:', e.message);
      await this.bot.sendMessage(chatId,
        `❌ Gagal membuat QR QRIS: ${e.message}\n\nCoba lagi atau pilih metode lain.`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '🔄 Coba Lagi', callback_data: `paymethod_${orderId}_qris` }],
            [{ text: '🔙 Pilih Metode Lain', callback_data: `paymethod_back_${orderId}` }],
          ]}
        }
      );
    }
  }

  // Kirim info Virtual Account
  async sendVAPayment(chatId, msgId, orderId, order, vaMethod) {
    try {
      await this.bot.editMessageText(
        `⏳ *Membuat Virtual Account...*\n\n🔖 \`${orderId}\`\n💰 ${formatCurrency(order.price)}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );

      const payment = await this.pakasir.createVATransaction(orderId, order.price, vaMethod);

      const bankName = vaMethod.replace('_va', '').toUpperCase();
      const expiredAt = new Date(payment.expired_at);
      const expStr    = expiredAt.toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

      const text =
        `🏦 *Virtual Account ${bankName}*\n\n` +
        `🔖 Order: \`${orderId}\`\n` +
        `📦 ${order.product_name}\n\n` +
        `🔢 *Nomor VA:*\n` +
        `\`${payment.payment_number}\`\n\n` +
        `💰 Total Bayar: *${formatCurrency(payment.total_payment || order.price)}*\n` +
        `⏰ Berlaku sampai: ${expStr}\n\n` +
        `_Transfer tepat sesuai nominal di atas_`;

      await this.bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Saya Sudah Transfer', callback_data: `cek_pay_${orderId}` }],
          [{ text: '🔄 Ganti Metode Bayar', callback_data: `paymethod_back_${orderId}` }],
          [{ text: '❌ Batalkan', callback_data: `cancel_order_${orderId}` }],
        ]}
      });

    } catch (e) {
      console.error('VA error:', e.message);
      await this.bot.editMessageText(
        `❌ Gagal membuat VA: ${e.message}\n\nCoba pilih metode lain.`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '🔙 Pilih Metode Lain', callback_data: `paymethod_back_${orderId}` }],
          ]}
        }
      );
    }
  }

  // ════════════════ DYNAMIC TRIGGERS & STATE ══════════════════
  async handleDynamicTriggers(msg) {
    if (!msg.text) return;
    const text   = msg.text.trim();
    const userId = msg.from.id;
    this.db.trackUser(userId, msg.from.username);

    // Cek state user (misal: waiting_order_id, waiting_note_)
    const state = this.db.getUserState(userId);

    if (state === 'waiting_order_id') {
      this.db.clearUserState(userId);
      const orderId = text.trim().toUpperCase();
      const order   = this.db.getOrder(orderId);
      if (!order) return this.bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan. Cek kembali Order ID kamu.');
      const emj = { pending:'⏳', paid:'✅', delivered:'📬', cancelled:'❌', preorder:'📋' };
      return this.bot.sendMessage(msg.chat.id,
        `📋 *Status Pesanan*\n\n🔖 \`${order.id}\`\n📦 ${order.product_name}\n💰 ${formatCurrency(order.price)}\n${emj[order.status]||'📌'} *${order.status.toUpperCase()}*\n📅 ${new Date(order.created_at).toLocaleString('id-ID')}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu_main' }]] } }
      );
    }

    if (state && state.startsWith('waiting_note_')) {
      this.db.clearUserState(userId);
      const productId = state.replace('waiting_note_', '');
      const note = text.trim().substring(0, 300); // batasi panjang catatan
      await this.createOrderAndShowPayment(msg.chat.id, null, userId, msg.from, productId, note);
      return;
    }

    // Dynamic triggers
    const triggers = this.db.getTriggers();
    for (const t of triggers) {
      if (text.toLowerCase() === t.trigger.toLowerCase()) {
        if (t.photo_file_id) {
          await this.bot.sendPhoto(msg.chat.id, t.photo_file_id, { caption: t.response, parse_mode: 'Markdown' });
        } else {
          await this.bot.sendMessage(msg.chat.id, t.response, { parse_mode: 'Markdown' });
        }
        return;
      }
    }
  }

  // ════════════════ ADMIN HANDLERS ════════════════════════════
  async handleAddStock(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    const parts = args.split('|');
    if (parts.length < 2) return this.bot.sendMessage(msg.chat.id, '❌ Format: `/addstock [nama]|[data1],[data2]`', { parse_mode: 'Markdown' });
    const product = this.db.findProduct(parts[0].trim());
    if (!product) return this.bot.sendMessage(msg.chat.id, `❌ Produk tidak ditemukan.`);
    const items = parts[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const item of items) this.db.addStockItem(product.id, item);
    await this.bot.sendMessage(msg.chat.id, `✅ *${items.length}* item stok ditambahkan ke *${product.name}*.\nTotal: *${this.db.getStockCount(product.id)}*`, { parse_mode: 'Markdown' });
  }

  async handleAddProduct(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    const parts = args.split('|');
    if (parts.length < 2) return this.bot.sendMessage(msg.chat.id, '❌ Format: `/addproduct Nama|Harga|Deskripsi|yes/no`', { parse_mode: 'Markdown' });
    const product = { id: Date.now().toString(), name: parts[0].trim(), price: parseInt(parts[1].replace(/\D/g,'')), description: parts[2]?.trim()||'', preorder_only: parts[3]?.trim().toLowerCase()==='yes', active: true, created_at: Date.now() };
    this.db.addProduct(product);
    await this.bot.sendMessage(msg.chat.id, `✅ Produk *${product.name}* ditambahkan!`, { parse_mode: 'Markdown' });
  }

  async handleConfirmPayment(msg, orderId) {
    if (!this.isAdmin(msg.from.id)) return;
    const order = this.db.getOrder(orderId.trim().toUpperCase());
    if (!order) return this.bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');
    if (order.status === 'delivered') return this.bot.sendMessage(msg.chat.id, '⚠️ Sudah terkirim.');
    const stockItem = this.db.getRandomStock(order.product_id);
    if (!stockItem && order.type !== 'preorder') return this.bot.sendMessage(msg.chat.id, `❌ Stok habis!`);
    this.db.updateOrderStatus(order.id, 'delivered');
    if (stockItem) this.db.markStockSold(stockItem.id, order.id);
    const text = stockItem
      ? `✅ *Pembayaran Dikonfirmasi!*\n\n🔖 \`${order.id}\`\n📦 *${order.product_name}*\n\n🎁 *Detail:*\n\`\`\`\n${stockItem.data}\n\`\`\`\n\n_Terima kasih! 🙏_`
      : `✅ *Dikonfirmasi!* Produk pre-order sedang diproses.`;
    await this.bot.sendMessage(order.user_id, text, { parse_mode: 'Markdown' });
    this.db.recordSale(order);
    await this.bot.sendMessage(msg.chat.id, `✅ Order *${order.id}* dikonfirmasi & terkirim ke @${order.username}`, { parse_mode: 'Markdown' });
  }

  async handleRejectOrder(msg, orderId) {
    if (!this.isAdmin(msg.from.id)) return;
    const order = this.db.getOrder(orderId.trim().toUpperCase());
    if (!order) return this.bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');
    this.db.updateOrderStatus(order.id, 'cancelled');
    await this.bot.sendMessage(order.user_id, `❌ *Pesanan Dibatalkan*\n\nOrder \`${order.id}\` dibatalkan.`, { parse_mode: 'Markdown' });
    await this.bot.sendMessage(msg.chat.id, `✅ Order ${order.id} dibatalkan.`);
  }

  async handleListOrders(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    const orders = this.db.getPendingOrders();
    if (!orders.length) return this.bot.sendMessage(msg.chat.id, '📭 Tidak ada pesanan pending.');
    let text = '📋 *Pesanan Pending:*\n\n';
    for (const o of orders) {
      text += `🔖 \`${o.id}\` - @${o.username}\n📦 ${o.product_name} - ${formatCurrency(o.price)}\n_/confirm ${o.id}_\n\n`;
    }
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleStockList(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    const products = this.db.getProducts();
    let text = '📦 *Status Stok:*\n\n';
    for (const p of products) {
      const count = this.db.getStockCount(p.id);
      text += `${count===0?'❌':count<5?'⚠️':'✅'} *${p.name}*: ${count} item\n`;
    }
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleAddTrigger(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    const parts = args.split('|');
    if (parts.length < 2) return this.bot.sendMessage(msg.chat.id, '❌ Format: `/addtrigger /cmd|Teks`', { parse_mode: 'Markdown' });
    this.db.addTrigger({ trigger: parts[0].trim(), response: parts.slice(1).join('|').trim(), photo_file_id: null, created_at: Date.now() });
    await this.bot.sendMessage(msg.chat.id, `✅ Trigger *${parts[0].trim()}* ditambahkan!`, { parse_mode: 'Markdown' });
  }

  async handleDelTrigger(msg, trigger) {
    if (!this.isAdmin(msg.from.id)) return;
    this.db.deleteTrigger(trigger.trim());
    await this.bot.sendMessage(msg.chat.id, `✅ Trigger *${trigger}* dihapus.`, { parse_mode: 'Markdown' });
  }

  async handleListTriggers(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    const triggers = this.db.getTriggers();
    if (!triggers.length) return this.bot.sendMessage(msg.chat.id, '📭 Belum ada trigger.');
    let text = '⚡ *Trigger:*\n\n';
    for (const t of triggers) text += `• \`${t.trigger}\` ${t.photo_file_id?'🖼':''}\n`;
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleBroadcast(msg, text) {
    if (!this.isAdmin(msg.from.id)) return;
    const users = this.db.getAllUserIds();
    let sent = 0, failed = 0;
    for (const uid of users) {
      try { await this.bot.sendMessage(uid, `📢 *Pengumuman*\n\n${text}`, { parse_mode: 'Markdown' }); sent++; await new Promise(r=>setTimeout(r,50)); }
      catch { failed++; }
    }
    await this.bot.sendMessage(msg.chat.id, `📢 Selesai!\n✅ ${sent} berhasil\n❌ ${failed} gagal`);
  }

  async handleDailyReport(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    await this.sendDailyReport(msg.chat.id);
  }

  async handleAutoOrder(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    this.db.setAutoOrder(args.trim().toLowerCase() === 'on');
    await this.bot.sendMessage(msg.chat.id, `🤖 Auto-order ${args.trim().toLowerCase()==='on'?'aktif':'nonaktif'}.`);
  }

  async handleHideTag(msg, text) {
    if (!this.isAdmin(msg.from.id)) return;
    if (!text) return this.bot.sendMessage(msg.chat.id, '📌 Cara pakai: `/hidetag [pesan]`', { parse_mode: 'Markdown' });
    await this.bot.sendMessage(msg.chat.id, `\u2060${text}`, { parse_mode: 'HTML' });
    try { await this.bot.deleteMessage(msg.chat.id, msg.message_id); } catch {}
  }

  async handlePhotoUpload(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    if (!msg.caption) return;
    const caption = msg.caption.trim();
    const fileId  = msg.photo[msg.photo.length - 1].file_id;
    if (caption.startsWith('/setpay')) {
      const payText = caption.replace('/setpay', '').trim() || '💳 Scan QR di bawah.';
      this.db.setPaymentInfo(payText, fileId);
      return this.bot.sendMessage(msg.chat.id, '✅ QR QRIS & info pembayaran disimpan!');
    }
    if (caption.startsWith('/settriggerpic ')) {
      const triggerName = caption.replace('/settriggerpic', '').trim();
      this.db.updateTriggerPhoto(triggerName, fileId);
      return this.bot.sendMessage(msg.chat.id, `✅ Foto trigger *${triggerName}* disimpan!`, { parse_mode: 'Markdown' });
    }
  }

  // ════════════════ DAILY REPORT ══════════════════════════════
  async sendDailyReport(targetId) {
    const r    = this.db.getDailyReport();
    const text = `📊 *Laporan - ${new Date().toLocaleDateString('id-ID')}*\n\n💰 Pendapatan: *${formatCurrency(r.revenue)}*\n📦 Terjual: *${r.sold}*\n🆕 Order Baru: *${r.new_orders}*\n❌ Batal: *${r.cancelled}*\n📋 Pre-Order: *${r.preorders}*\n\n🏆 Terlaris:\n${r.top_products.map((p,i)=>`${i+1}. ${p.name}: ${p.count}x`).join('\n')||'_Belum ada_'}`;
    await this.bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
  }

  scheduleDailyReport() {
    const now  = new Date();
    const next = new Date(); next.setHours(23,59,0,0);
    if (next <= now) next.setDate(next.getDate()+1);
    setTimeout(async () => {
      for (const id of this.adminIds) try { await this.sendDailyReport(id); } catch {}
      setInterval(async () => { for (const id of this.adminIds) try { await this.sendDailyReport(id); } catch {} }, 86400000);
    }, next - now);
  }
}

module.exports = ShopBot;
