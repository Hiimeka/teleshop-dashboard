# 🤖 Telegram Shop Bot + Dashboard Admin

Bot toko Telegram lengkap dengan dashboard admin React, API REST, manajemen stok, trigger foto, broadcast, pre-order, dan laporan harian.

---

## 📁 Struktur Proyek

```
telegram-bot-shop/
├── index.js              # Entry point
├── package.json
├── .env.example          # Template konfigurasi
├── bot/
│   ├── bot.js            # Core bot logic
│   ├── database.js       # Database JSON
│   ├── api-server.js     # REST API untuk dashboard
│   └── utils.js          # Helper functions
├── dashboard/            # React Dashboard
│   ├── src/App.jsx       # Semua halaman dashboard
│   ├── index.html
│   └── package.json
└── database/
    └── db.json           # Data tersimpan otomatis
```

---

## ⚡ Instalasi

### 1. Bot (Backend)
```bash
cd telegram-bot-shop
npm install
cp .env.example .env
# Edit .env dengan token bot dan admin ID kamu
npm start
```

### 2. Dashboard (Frontend)
```bash
cd dashboard
npm install
npm run dev
# Buka http://localhost:5173
```

---

## ⚙️ Konfigurasi `.env`

```env
BOT_TOKEN=token_dari_botfather
ADMIN_IDS=123456789,987654321    # ID Telegram admin, pisah koma
API_PORT=3001                    # Port API server
DASHBOARD_API_KEY=rahasia123     # API key untuk dashboard
```

**Cara dapat User ID Telegram:** Chat @userinfobot di Telegram.

---

## 🤖 Perintah Bot

### 👤 User
| Perintah | Fungsi |
|----------|--------|
| `/start` | Sambutan |
| `/products` | Lihat daftar produk |
| `/order [nama]` | Pesan produk |
| `/pay` | Info pembayaran + QR QRIS |
| `/status [order_id]` | Cek status pesanan |
| `/preorder [nama]` | Pre-order produk |
| `/help` | Bantuan |

### 👑 Admin
| Perintah | Fungsi |
|----------|--------|
| `/addproduct Nama\|Harga\|Deskripsi\|yes/no` | Tambah produk |
| `/addstock NamaProduk\|data1,data2` | Tambah stok |
| `/confirm ORD-XXXX` | Konfirmasi pembayaran, kirim stok random ke user |
| `/rejectorder ORD-XXXX` | Batalkan pesanan |
| `/orders` | Lihat pesanan pending |
| `/stocklist` | Status stok semua produk |
| `/addtrigger /perintah\|Teks balasan` | Tambah trigger teks |
| `/deltrigger /perintah` | Hapus trigger |
| `/triggers` | Daftar trigger |
| `/broadcast Pesan` | Kirim pesan ke semua user |
| `/report` | Laporan harian |
| `/autoorder on\|off` | Toggle auto-order |

### 📸 Upload Foto (Admin)
| Cara | Fungsi |
|------|--------|
| Kirim foto + caption `/setpay Teks info` | Set QR QRIS + info pembayaran |
| Kirim foto + caption `/settriggerpic /perintah` | Set foto untuk trigger |

---

## 🌐 Dashboard Admin

Buka `http://localhost:5173` setelah jalankan dashboard.

### Fitur Dashboard:
- **📊 Dashboard** - Statistik real-time, grafik pendapatan, order pending
- **📋 Pesanan** - Filter by status, konfirmasi/tolak order langsung dari dashboard
- **🛍️ Produk** - Tambah/hapus produk, set pre-order only
- **📦 Stok** - Tambah stok bulk (1 per baris), lihat stok tersedia/terjual
- **⚡ Triggers** - Kelola trigger & command dengan/tanpa foto
- **📢 Broadcast** - Kirim pesan massal ke semua user
- **📊 Laporan** - Revenue chart 30 hari, produk terlaris
- **⚙️ Pengaturan** - Konfigurasi API, auto-order, info pembayaran

---

## 🔒 Keamanan

- API key untuk autentikasi dashboard → bot
- Admin ID whitelist untuk perintah admin
- Data stok yang sudah terjual disamarkan di dashboard

---

## 💡 Contoh Penggunaan

### Tambah Produk Netflix:
```
/addproduct Netflix Premium 1 Bulan|50000|Akun premium sharing|no
```

### Tambah Stok Netflix:
```
/addstock Netflix Premium 1 Bulan|email1@gmail.com:pass1,email2@gmail.com:pass2
```

### Set QR QRIS:
Kirim foto QR code di Telegram dengan caption:
```
/setpay 💳 Transfer ke QRIS di bawah atau BCA 1234567890 a/n Toko Saya
```

### Trigger Custom:
```
/addtrigger /cara_order|Cara order: ketik /products pilih produk, lalu /order [nama]
```

---

## 🔄 Flow Pembelian

```
User: /order Netflix Premium
  → Bot buat order, kirim ke user & notif admin
  
User: klik "Lihat Pembayaran"  
  → Bot kirim foto QR QRIS + detail harga
  
User: transfer + kirim bukti ke admin
  
Admin: /confirm ORD-XXXXXXXX
  → Bot pilih stok RANDOM
  → Kirim data akun ke user via DM
  → Order ditandai "Delivered"
  → Tercatat di laporan harian
```

---

## 📊 Laporan Harian Otomatis

Bot otomatis kirim laporan ke semua admin setiap pukul **23:59** berisi:
- Total pendapatan hari ini
- Jumlah terjual
- Order baru, dibatalkan, pre-order
- Top 5 produk terlaris
