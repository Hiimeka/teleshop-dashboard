const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const { formatCurrency, generateOrderId, getRandomStock } = require('./utils');

class ShopBot {
  constructor(token, adminIds) {
    this.bot = new TelegramBot(token, { polling: true });
    this.db = new Database();
    this.adminIds = adminIds.map(String);
    this.setupHandlers();
    this.scheduleDailyReport();
    console.log('🤖 Bot started successfully!');
  }

  isAdmin(userId) {
    return this.adminIds.includes(String(userId));
  }

  setupHandlers() {
    // ── USER COMMANDS ──
    this.bot.onText(/^\/start$/, (msg) => this.handleStart(msg));
    this.bot.onText(/^\/products$/, (msg) => this.handleProducts(msg));
    this.bot.onText(/^\/order (.+)$/, (msg, match) => this.handleOrder(msg, match[1]));
    this.bot.onText(/^\/pay$/, (msg) => this.handlePay(msg));
    this.bot.onText(/^\/status (.+)$/, (msg, match) => this.handleStatus(msg, match[1]));
    this.bot.onText(/^\/preorder (.+)$/, (msg, match) => this.handlePreOrder(msg, match[1]));
    this.bot.onText(/^\/help$/, (msg) => this.handleHelp(msg));

    // ── ADMIN COMMANDS ──
    this.bot.onText(/^\/addstock (.+)$/, (msg, match) => this.handleAddStock(msg, match[1]));
    this.bot.onText(/^\/addproduct (.+)$/, (msg, match) => this.handleAddProduct(msg, match[1]));
    this.bot.onText(/^\/confirm (.+)$/, (msg, match) => this.handleConfirmPayment(msg, match[1]));
    this.bot.onText(/^\/addtrigger (.+)$/, (msg, match) => this.handleAddTrigger(msg, match[1]));
    this.bot.onText(/^\/deltrigger (.+)$/, (msg, match) => this.handleDelTrigger(msg, match[1]));
    this.bot.onText(/^\/triggers$/, (msg) => this.handleListTriggers(msg));
    this.bot.onText(/^\/broadcast (.+)$/, (msg, match) => this.handleBroadcast(msg, match[1]));
    this.bot.onText(/^\/report$/, (msg) => this.handleDailyReport(msg));
    this.bot.onText(/^\/orders$/, (msg) => this.handleListOrders(msg));
    this.bot.onText(/^\/rejectorder (.+)$/, (msg, match) => this.handleRejectOrder(msg, match[1]));
    this.bot.onText(/^\/stocklist$/, (msg) => this.handleStockList(msg));
    this.bot.onText(/^\/autoorder (.+)$/, (msg, match) => this.handleAutoOrder(msg, match[1]));

    // ── DYNAMIC TRIGGERS ──
    this.bot.on('message', (msg) => this.handleDynamicTriggers(msg));

    // ── CALLBACK QUERIES ──
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

    // ── PHOTO (admin upload for trigger) ──
    this.bot.on('photo', (msg) => this.handlePhotoUpload(msg));

    // ── HIDE TAG ──
    this.bot.onText(/^\/hidetag (.+)$/, (msg, match) => this.handleHideTag(msg, match[1]));
    this.bot.onText(/^\/hidetag$/, (msg) => this.handleHideTag(msg, null));
  }

  // ════════════════ USER HANDLERS ════════════════

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'Pembeli';
    await this.bot.sendMessage(chatId,
      `👋 Halo *${name}*! Selamat datang di toko kami.\n\n` +
      `Gunakan perintah berikut:\n` +
      `📦 /products - Lihat semua produk\n` +
      `🛒 /order [nama_produk] - Pesan produk\n` +
      `💳 /pay - Info pembayaran\n` +
      `📋 /status [order_id] - Cek status pesanan\n` +
      `❓ /help - Bantuan`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleProducts(msg) {
    const chatId = msg.chat.id;
    const products = this.db.getProducts();
    if (!products.length) {
      return this.bot.sendMessage(chatId, '📭 Belum ada produk tersedia.');
    }
    let text = '🛍️ *Daftar Produk*\n\n';
    for (const p of products) {
      const stock = this.db.getStockCount(p.id);
      const preorder = p.preorder_only ? ' _(Pre-Order)_' : '';
      text += `• *${p.name}*${preorder}\n`;
      text += `  💰 ${formatCurrency(p.price)}\n`;
      text += `  📦 Stok: ${p.preorder_only ? 'Pre-Order' : (stock > 0 ? stock + ' tersedia' : '❌ Habis')}\n`;
      if (p.description) text += `  📝 ${p.description}\n`;
      text += '\n';
    }
    text += `_Pesan dengan: /order [nama produk]_`;
    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  async handleOrder(msg, productName) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const product = this.db.findProduct(productName.trim());
    if (!product) {
      return this.bot.sendMessage(chatId, `❌ Produk *${productName}* tidak ditemukan.\nGunakan /products untuk melihat daftar produk.`, { parse_mode: 'Markdown' });
    }
    const stockCount = this.db.getStockCount(product.id);
    if (!product.preorder_only && stockCount === 0) {
      // Tawarkan pre-order jika stok habis
      const keyboard = {
        inline_keyboard: [[
          { text: '📋 Pre-Order', callback_data: `preorder_${product.id}` },
          { text: '❌ Batal', callback_data: 'cancel' }
        ]]
      };
      return this.bot.sendMessage(chatId,
        `❌ Stok *${product.name}* sedang habis.\nMau pre-order?`, 
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    }
    const orderId = generateOrderId();
    this.db.createOrder({
      id: orderId,
      user_id: userId,
      username: msg.from.username || msg.from.first_name,
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      status: 'pending',
      type: product.preorder_only ? 'preorder' : 'normal',
      created_at: Date.now()
    });
    const keyboard = {
      inline_keyboard: [[
        { text: '💳 Lihat Pembayaran', callback_data: `show_pay_${orderId}` },
        { text: '❌ Batalkan', callback_data: `cancel_order_${orderId}` }
      ]]
    };
    await this.bot.sendMessage(chatId,
      `✅ *Pesanan Dibuat!*\n\n` +
      `🔖 Order ID: \`${orderId}\`\n` +
      `📦 Produk: *${product.name}*\n` +
      `💰 Harga: *${formatCurrency(product.price)}*\n` +
      `📊 Status: Menunggu Pembayaran\n\n` +
      `_Tekan tombol untuk lanjut ke pembayaran_`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    // Notif admin
    for (const adminId of this.adminIds) {
      await this.bot.sendMessage(adminId,
        `🆕 *Pesanan Baru!*\n` +
        `👤 User: @${msg.from.username || msg.from.first_name} (${userId})\n` +
        `🔖 Order ID: \`${orderId}\`\n` +
        `📦 Produk: ${product.name}\n` +
        `💰 Harga: ${formatCurrency(product.price)}\n` +
        `📋 Tipe: ${product.preorder_only ? 'Pre-Order' : 'Normal'}\n\n` +
        `_Konfirmasi: /confirm ${orderId}_`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  async handlePay(msg) {
    const chatId = msg.chat.id;
    const payInfo = this.db.getPaymentInfo();
    if (!payInfo) {
      return this.bot.sendMessage(chatId, '⚠️ Info pembayaran belum diatur admin.');
    }
    let text = `💳 *Informasi Pembayaran*\n\n${payInfo.text}`;
    if (payInfo.photo_file_id) {
      await this.bot.sendPhoto(chatId, payInfo.photo_file_id, {
        caption: text,
        parse_mode: 'Markdown'
      });
    } else {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }
  }

  async handleStatus(msg, orderId) {
    const chatId = msg.chat.id;
    const order = this.db.getOrder(orderId.trim().toUpperCase());
    if (!order) return this.bot.sendMessage(chatId, `❌ Order ID tidak ditemukan.`);
    const statusEmoji = { pending: '⏳', paid: '✅', delivered: '📬', cancelled: '❌', preorder: '📋' };
    await this.bot.sendMessage(chatId,
      `📋 *Status Pesanan*\n\n` +
      `🔖 Order ID: \`${order.id}\`\n` +
      `📦 Produk: ${order.product_name}\n` +
      `💰 Harga: ${formatCurrency(order.price)}\n` +
      `${statusEmoji[order.status] || '📌'} Status: *${order.status.toUpperCase()}*\n` +
      `📅 Dibuat: ${new Date(order.created_at).toLocaleString('id-ID')}`,
      { parse_mode: 'Markdown' }
    );
  }

  async handlePreOrder(msg, productName) {
    const chatId = msg.chat.id;
    const product = this.db.findProduct(productName.trim());
    if (!product) return this.bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');
    const orderId = generateOrderId();
    this.db.createOrder({
      id: orderId,
      user_id: msg.from.id,
      username: msg.from.username || msg.from.first_name,
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      status: 'preorder',
      type: 'preorder',
      created_at: Date.now()
    });
    await this.bot.sendMessage(chatId,
      `📋 *Pre-Order Berhasil!*\n\n` +
      `🔖 Order ID: \`${orderId}\`\n` +
      `📦 Produk: ${product.name}\n` +
      `💰 Harga: ${formatCurrency(product.price)}\n\n` +
      `Kami akan hubungi kamu saat stok tersedia.`,
      { parse_mode: 'Markdown' }
    );
    for (const adminId of this.adminIds) {
      await this.bot.sendMessage(adminId,
        `📋 *Pre-Order Baru!*\n` +
        `👤 @${msg.from.username || msg.from.first_name}\n` +
        `📦 ${product.name}\n` +
        `🔖 ${orderId}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;
    await this.bot.sendMessage(chatId,
      `❓ *Bantuan*\n\n` +
      `*/products* - Lihat produk\n` +
      `*/order [produk]* - Pesan produk\n` +
      `*/pay* - Info pembayaran & QR QRIS\n` +
      `*/status [id]* - Cek status\n` +
      `*/preorder [produk]* - Pre-order produk\n\n` +
      `_Hubungi admin untuk bantuan lebih lanjut_`,
      { parse_mode: 'Markdown' }
    );
  }

  // ════════════════ ADMIN HANDLERS ════════════════

  async handleAddStock(msg, args) {
    if (!this.isAdmin(msg.from.id)) return this.bot.sendMessage(msg.chat.id, '⛔ Akses ditolak.');
    // Format: /addstock ProductName|data1,data2,data3
    const parts = args.split('|');
    if (parts.length < 2) {
      return this.bot.sendMessage(msg.chat.id,
        '❌ Format: `/addstock [nama_produk]|[data1],[data2],[data3]`\n\nContoh:\n`/addstock Netflix Premium|acc1@mail.com:pass1,acc2@mail.com:pass2`',
        { parse_mode: 'Markdown' }
      );
    }
    const productName = parts[0].trim();
    const stockItems = parts[1].split(',').map(s => s.trim()).filter(Boolean);
    const product = this.db.findProduct(productName);
    if (!product) return this.bot.sendMessage(msg.chat.id, `❌ Produk *${productName}* tidak ditemukan.`, { parse_mode: 'Markdown' });
    let added = 0;
    for (const item of stockItems) {
      this.db.addStockItem(product.id, item);
      added++;
    }
    await this.bot.sendMessage(msg.chat.id,
      `✅ Berhasil menambahkan *${added}* item stok untuk *${product.name}*.\nTotal stok: *${this.db.getStockCount(product.id)}*`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleAddProduct(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    // Format: /addproduct Name|Price|Description|preorder
    const parts = args.split('|');
    if (parts.length < 2) {
      return this.bot.sendMessage(msg.chat.id,
        '❌ Format: `/addproduct [nama]|[harga]|[deskripsi]|[preorder: yes/no]`',
        { parse_mode: 'Markdown' }
      );
    }
    const product = {
      id: Date.now().toString(),
      name: parts[0].trim(),
      price: parseInt(parts[1].replace(/\D/g, '')),
      description: parts[2]?.trim() || '',
      preorder_only: parts[3]?.trim().toLowerCase() === 'yes',
      active: true,
      created_at: Date.now()
    };
    this.db.addProduct(product);
    await this.bot.sendMessage(msg.chat.id,
      `✅ Produk *${product.name}* berhasil ditambahkan!\n` +
      `💰 Harga: ${formatCurrency(product.price)}\n` +
      `📋 Tipe: ${product.preorder_only ? 'Pre-Order Only' : 'Normal'}\n` +
      `🔑 ID: \`${product.id}\``,
      { parse_mode: 'Markdown' }
    );
  }

  async handleConfirmPayment(msg, orderId) {
    if (!this.isAdmin(msg.from.id)) return;
    const order = this.db.getOrder(orderId.trim().toUpperCase());
    if (!order) return this.bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');
    if (order.status === 'delivered') return this.bot.sendMessage(msg.chat.id, '⚠️ Order sudah dikirim.');
    // Ambil stok random
    const stockItem = this.db.getRandomStock(order.product_id);
    if (!stockItem && order.type !== 'preorder') {
      return this.bot.sendMessage(msg.chat.id, `❌ Stok untuk *${order.product_name}* habis! Tidak bisa konfirmasi.`, { parse_mode: 'Markdown' });
    }
    // Update order status
    this.db.updateOrderStatus(order.id, 'delivered');
    if (stockItem) {
      this.db.markStockSold(stockItem.id, order.id);
    }
    // Kirim ke user
    const deliveryText = stockItem
      ? `✅ *Pembayaran Dikonfirmasi!*\n\n` +
        `🔖 Order: \`${order.id}\`\n` +
        `📦 Produk: *${order.product_name}*\n\n` +
        `🎁 *Detail Produk Anda:*\n\`\`\`\n${stockItem.data}\n\`\`\`\n\n` +
        `_Terima kasih sudah berbelanja! 🙏_`
      : `✅ *Pembayaran Dikonfirmasi!*\n\nProduk pre-order Anda sedang diproses.`;
    await this.bot.sendMessage(order.user_id, deliveryText, { parse_mode: 'Markdown' });
    // Auto-order check
    const autoOrders = this.db.getPreOrdersByProduct(order.product_id);
    let autoNote = '';
    if (autoOrders.length > 0) autoNote = `\n\n📋 Ada ${autoOrders.length} pre-order menunggu stok!`;
    await this.bot.sendMessage(msg.chat.id,
      `✅ Order *${order.id}* dikonfirmasi!\n` +
      `📬 Stok terkirim ke @${order.username}${autoNote}`,
      { parse_mode: 'Markdown' }
    );
    // Record daily report
    this.db.recordSale(order);
  }

  async handleRejectOrder(msg, orderId) {
    if (!this.isAdmin(msg.from.id)) return;
    const order = this.db.getOrder(orderId.trim().toUpperCase());
    if (!order) return this.bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');
    this.db.updateOrderStatus(order.id, 'cancelled');
    await this.bot.sendMessage(order.user_id,
      `❌ *Pesanan Dibatalkan*\n\nOrder \`${order.id}\` untuk *${order.product_name}* telah dibatalkan.\nHubungi admin jika ada pertanyaan.`,
      { parse_mode: 'Markdown' }
    );
    await this.bot.sendMessage(msg.chat.id, `✅ Order ${order.id} berhasil dibatalkan.`);
  }

  async handleAddTrigger(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    // Format: /addtrigger /command|Response text here
    const parts = args.split('|');
    if (parts.length < 2) {
      return this.bot.sendMessage(msg.chat.id,
        '❌ Format:\n`/addtrigger /perintah|Teks balasan`\n\n' +
        'Untuk trigger dengan foto, kirim foto dengan caption:\n`/settriggerpic /perintah`',
        { parse_mode: 'Markdown' }
      );
    }
    const trigger = parts[0].trim();
    const response = parts.slice(1).join('|').trim();
    this.db.addTrigger({ trigger, response, photo_file_id: null, created_at: Date.now() });
    await this.bot.sendMessage(msg.chat.id,
      `✅ Trigger *${trigger}* berhasil ditambahkan!\n\nBalasan: ${response.substring(0, 50)}...`,
      { parse_mode: 'Markdown' }
    );
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
    let text = '⚡ *Daftar Trigger:*\n\n';
    for (const t of triggers) {
      text += `• \`${t.trigger}\` ${t.photo_file_id ? '🖼' : '💬'}\n`;
    }
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleBroadcast(msg, text) {
    if (!this.isAdmin(msg.from.id)) return;
    const users = this.db.getAllUserIds();
    let sent = 0, failed = 0;
    const broadcastMsg = `📢 *Pengumuman*\n\n${text}`;
    for (const userId of users) {
      try {
        await this.bot.sendMessage(userId, broadcastMsg, { parse_mode: 'Markdown' });
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch { failed++; }
    }
    await this.bot.sendMessage(msg.chat.id, `📢 Broadcast selesai!\n✅ Terkirim: ${sent}\n❌ Gagal: ${failed}`);
  }

  async handleDailyReport(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    await this.sendDailyReport(msg.chat.id);
  }

  async handleListOrders(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    const orders = this.db.getPendingOrders();
    if (!orders.length) return this.bot.sendMessage(msg.chat.id, '📭 Tidak ada pesanan pending.');
    let text = '📋 *Pesanan Pending:*\n\n';
    for (const o of orders) {
      text += `🔖 \`${o.id}\` - @${o.username}\n`;
      text += `   📦 ${o.product_name} - ${formatCurrency(o.price)}\n`;
      text += `   _/confirm ${o.id} | /rejectorder ${o.id}_\n\n`;
    }
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleStockList(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    const products = this.db.getProducts();
    let text = '📦 *Status Stok:*\n\n';
    for (const p of products) {
      const count = this.db.getStockCount(p.id);
      const emoji = count === 0 ? '❌' : count < 5 ? '⚠️' : '✅';
      text += `${emoji} *${p.name}*: ${count} item\n`;
    }
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  async handleAutoOrder(msg, args) {
    if (!this.isAdmin(msg.from.id)) return;
    // /autoorder on|off
    const state = args.trim().toLowerCase();
    this.db.setAutoOrder(state === 'on');
    await this.bot.sendMessage(msg.chat.id, `🤖 Auto-order ${state === 'on' ? 'aktif' : 'nonaktif'}.`);
  }

  // ════════════════ DYNAMIC TRIGGERS ════════════════

  async handleDynamicTriggers(msg) {
    if (!msg.text) return;
    const text = msg.text.trim().toLowerCase();
    // Track user
    this.db.trackUser(msg.from.id, msg.from.username);
    const triggers = this.db.getTriggers();
    for (const t of triggers) {
      if (text === t.trigger.toLowerCase()) {
        if (t.photo_file_id) {
          await this.bot.sendPhoto(msg.chat.id, t.photo_file_id, {
            caption: t.response,
            parse_mode: 'Markdown'
          });
        } else {
          await this.bot.sendMessage(msg.chat.id, t.response, { parse_mode: 'Markdown' });
        }
        return;
      }
    }
  }

  // ════════════════ HIDE TAG ════════════════

  async handleHideTag(msg, text) {
    const chatId = msg.chat.id;
    if (!this.isAdmin(msg.from.id)) return;
    const content = text || '';
    if (!content) {
      return this.bot.sendMessage(chatId,
        `📌 *Cara pakai Hide Tag:*\n\n` +
        `*/hidetag [teks]* — kirim pesan tanpa memperlihatkan username kamu\n\n` +
        `Atau forward pesan ke bot → bot re-kirim tanpa tag sumber`,
        { parse_mode: 'Markdown' }
      );
    }
    // Trick: gunakan invisible character U+2060 untuk "sembunyikan" mention
    // Pesan dikirim oleh bot (bukan user), jadi username tidak muncul
    await this.bot.sendMessage(chatId,
      `\u2060${content}`,
      { parse_mode: 'HTML' }
    );
    try { await this.bot.deleteMessage(chatId, msg.message_id); } catch {}
  }

  // ════════════════ PHOTO UPLOAD (for triggers) ════════════════

  async handlePhotoUpload(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    if (!msg.caption) return;
    const caption = msg.caption.trim();
    if (!caption.startsWith('/settriggerpic ') && !caption.startsWith('/setpay')) return;
    const photos = msg.photo;
    const fileId = photos[photos.length - 1].file_id;
    if (caption.startsWith('/setpay')) {
      const payText = caption.replace('/setpay', '').trim() || '💳 Silakan transfer ke rekening kami.';
      this.db.setPaymentInfo(payText, fileId);
      return this.bot.sendMessage(msg.chat.id, '✅ Info pembayaran & foto QRIS berhasil disimpan!');
    }
    const triggerName = caption.replace('/settriggerpic', '').trim();
    const existing = this.db.getTrigger(triggerName);
    if (!existing) {
      this.db.addTrigger({ trigger: triggerName, response: '', photo_file_id: fileId, created_at: Date.now() });
    } else {
      this.db.updateTriggerPhoto(triggerName, fileId);
    }
    await this.bot.sendMessage(msg.chat.id, `✅ Foto untuk trigger *${triggerName}* disimpan!`, { parse_mode: 'Markdown' });
  }

  // ════════════════ CALLBACK QUERIES ════════════════

  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    await this.bot.answerCallbackQuery(query.id);
    if (data.startsWith('show_pay_')) {
      const orderId = data.replace('show_pay_', '');
      const order = this.db.getOrder(orderId);
      if (!order) return;
      const payInfo = this.db.getPaymentInfo();
      const payText = payInfo
        ? `💳 *Pembayaran untuk Order \`${orderId}\`*\n\n${payInfo.text}\n\n💰 Jumlah: *${formatCurrency(order.price)}*\n\n_Kirim bukti ke admin setelah transfer._`
        : `💰 Jumlah yang harus dibayar: *${formatCurrency(order.price)}*\n\n_Hubungi admin untuk info pembayaran._`;
      if (payInfo?.photo_file_id) {
        await this.bot.sendPhoto(chatId, payInfo.photo_file_id, { caption: payText, parse_mode: 'Markdown' });
      } else {
        await this.bot.sendMessage(chatId, payText, { parse_mode: 'Markdown' });
      }
    } else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');
      this.db.updateOrderStatus(orderId, 'cancelled');
      await this.bot.editMessageText(`❌ Order \`${orderId}\` dibatalkan.`, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'
      });
    } else if (data.startsWith('preorder_')) {
      const productId = data.replace('preorder_', '');
      const product = this.db.getProductById(productId);
      if (product) {
        const orderId = generateOrderId();
        this.db.createOrder({ id: orderId, user_id: query.from.id, username: query.from.username || query.from.first_name, product_id: product.id, product_name: product.name, price: product.price, status: 'preorder', type: 'preorder', created_at: Date.now() });
        await this.bot.editMessageText(`📋 Pre-order *${product.name}* berhasil!\nOrder ID: \`${orderId}\``, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      }
    } else if (data === 'cancel') {
      await this.bot.editMessageText('❌ Dibatalkan.', { chat_id: chatId, message_id: query.message.message_id });
    }
  }

  // ════════════════ DAILY REPORT ════════════════

  async sendDailyReport(targetId) {
    const report = this.db.getDailyReport();
    const text =
      `📊 *Laporan Harian - ${new Date().toLocaleDateString('id-ID')}*\n\n` +
      `💰 Total Pendapatan: *${formatCurrency(report.revenue)}*\n` +
      `📦 Total Terjual: *${report.sold} item*\n` +
      `🆕 Pesanan Baru: *${report.new_orders}*\n` +
      `❌ Dibatalkan: *${report.cancelled}*\n` +
      `📋 Pre-Order: *${report.preorders}*\n\n` +
      `🏆 Produk Terlaris:\n${report.top_products.map((p, i) => `${i+1}. ${p.name}: ${p.count}x`).join('\n') || '_Belum ada_'}`;
    await this.bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
  }

  scheduleDailyReport() {
    const now = new Date();
    const next = new Date();
    next.setHours(23, 59, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    setTimeout(async () => {
      for (const adminId of this.adminIds) {
        try { await this.sendDailyReport(adminId); } catch {}
      }
      setInterval(async () => {
        for (const adminId of this.adminIds) {
          try { await this.sendDailyReport(adminId); } catch {}
        }
      }, 24 * 60 * 60 * 1000);
    }, delay);
  }
}

module.exports = ShopBot;
