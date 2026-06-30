# ShopBot — Telegram Shop Bot + Admin Console

Bot toko digital untuk Telegram dengan dashboard admin React bertema cyberpunk, pembayaran otomatis (QRIS & Virtual Account via Pakasir), landing page toko publik, dan halaman cek stok real-time — semuanya berbasis tombol inline, tanpa perlu pelanggan mengetik command.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Struktur Proyek](#struktur-proyek)
- [Arsitektur & Routing](#arsitektur--routing)
- [Instalasi](#instalasi)
- [Konfigurasi Environment Variables](#konfigurasi-environment-variables)
- [Perintah Bot](#perintah-bot)
- [Halaman Dashboard](#halaman-dashboard)
- [Setup Pakasir (Payment Gateway)](#setup-pakasir-payment-gateway)
- [Deploy ke Railway + Vercel](#deploy-ke-railway--vercel)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)

---

## Fitur Utama

### Bot Telegram (tanpa command, full tombol inline)
- **Menu utama berbasis tombol** — pelanggan tidak perlu mengetik command sama sekali, semua interaksi lewat inline keyboard
- **Browsing produk per kategori** — daftar produk tampil sebagai tombol terpisah, tidak perlu scroll panjang
- **Catatan pesanan custom** — pelanggan bisa kirim permintaan khusus saat order (misal: "akun yang masih lama", "warna biru") sebelum lanjut ke pembayaran
- **Pilihan metode pembayaran langsung di chat** — QRIS (kirim sebagai gambar QR langsung, tidak perlu buka link) atau 9 pilihan Virtual Account bank
- **Auto-delivery stok** — setelah pembayaran terverifikasi (manual oleh admin atau otomatis via webhook Pakasir), stok dikirim **acak** dari daftar stok yang tersedia
- **Cek status pesanan** — pelanggan kirim Order ID, bot balas status terkini
- **Cek stok real-time via website** — tombol khusus yang mengarahkan ke halaman publik tanpa login, auto-refresh
- **Pre-order** — produk bisa diset hanya tersedia via pre-order, tetap bisa dipesan meski stok kosong
- **Trigger custom** — admin bisa buat command custom (misal `/garansi`, `/cara_order`) dengan teks atau foto balasan
- **Hide tag** — kirim pesan admin tanpa menampilkan username pengirim
- **Custom greeting** — pesan sambutan `/start` bisa diatur lewat dashboard, support placeholder `{name}`
- **Broadcast** — kirim pengumuman ke semua pelanggan yang pernah chat bot, dengan detail laporan siapa yang gagal terkirim dan alasannya
- **Laporan harian otomatis** — terkirim ke semua admin setiap pukul 23:59

### Payment Gateway (Pakasir)
- **QRIS langsung di chat** — bot generate gambar QR code dan kirim langsung, pelanggan tidak perlu pindah ke website
- **9 metode Virtual Account** — BRI, BNI, CIMB Niaga, Permata, Maybank, BNC, Sampoerna, ATM Bersama, Artha Graha
- **Webhook otomatis** — begitu pelanggan bayar, stok terkirim otomatis tanpa perlu admin konfirmasi manual
- **Cek status manual** — tombol "Saya Sudah Bayar" untuk verifikasi ulang jika webhook terlambat

### Dashboard Admin (React, tema cyberpunk)
- **Login dengan username & password** — sistem token JWT, bukan API key statis
- **Role-based access** — Admin (akses penuh) vs Member (operasional harian)
- **Manajemen produk** — tambah produk, edit harga inline langsung dari kartu produk
- **Manajemen stok** — tambah stok massal (satu baris per item), filter berdasarkan produk dan status (tersedia/terjual)
- **Manajemen pesanan** — konfirmasi/tolak pesanan langsung dari dashboard, lihat catatan khusus pelanggan
- **Trigger & command** — kelola command custom bot dari web, tanpa perlu chat manual ke bot
- **Broadcast** — kirim pengumuman massal dengan preview sebelum kirim, laporan detail jika ada yang gagal
- **Laporan & analitik** — grafik pendapatan 7/30 hari, produk terlaris, ringkasan harian
- **Log akses** — riwayat siapa melakukan aksi apa (tambah stok, konfirmasi order, dll), bisa difilter per jenis aksi
- **Manajemen user dashboard** — admin bisa tambah/edit/hapus akun member lain
- **Pengaturan terpusat** — status koneksi API, ganti password, info pembayaran manual, custom greeting bot, status Pakasir, link redirect ke bot
- **Responsif penuh** — di desktop tampil sebagai tabel, di mobile otomatis berubah jadi kartu agar tidak perlu scroll horizontal
- **Sidebar collapsible** — bisa diperkecil jadi mode ikon saja untuk memperluas area kerja

### Halaman Publik (tanpa login)
- **Landing page toko** (`/`) — halaman depan ala toko online digital, menampilkan daftar produk, tombol order langsung ke bot, dan trust badge
- **Cek stok real-time** (`/stock`) — daftar produk dan status stok yang auto-refresh setiap 15 detik, tidak pernah menampilkan data akun/password
- Kedua halaman ini **hanya menampilkan data aman** (nama produk, harga, status stok) — data kredensial akun tidak pernah diekspos lewat endpoint publik

---

## Struktur Proyek

```
telegram-bot-shop/
├── index.js                    # Entry point — start API server dulu, baru init bot Telegram
├── package.json
├── package-lock.json
├── .env.example                 # Template environment variables (Railway)
├── .gitignore
├── Procfile                      # Untuk platform yang butuh Procfile
├── nixpacks.toml                 # Konfigurasi build Railway
├── railway.toml                  # Health check & restart policy Railway
├── setup.sh                      # Script instalasi otomatis
├── README.md
│
├── bot/
│   ├── bot.js                   # Logic bot Telegram — menu tombol, order flow, pembayaran
│   ├── database.js               # Database JSON (file-based), termasuk dashboard users terpisah
│   ├── api-server.js             # REST API Express — endpoint dashboard + endpoint publik
│   ├── auth.js                   # JWT token generate/verify untuk login dashboard
│   └── pakasir.js                # SDK Pakasir — QRIS, Virtual Account, webhook
│
├── dashboard/                     # React + Vite dashboard
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── vercel.json                # Rewrite rule agar semua route SPA tidak 404 di Vercel
│   ├── .env.example
│   └── src/
│       ├── main.jsx               # Routing path: / , /stock , /login , /dashboard
│       ├── App.jsx                # Dashboard admin + halaman login
│       ├── LandingPage.jsx        # Landing page toko (publik)
│       └── StockCheckPage.jsx     # Halaman cek stok real-time (publik)
│
└── database/
    ├── db.json                    # Data utama — dibuat otomatis saat pertama jalan
    └── dashboard_users.json        # Data user dashboard — file terpisah agar lebih aman
```

---

## Arsitektur & Routing

### Backend (Railway)
Satu service Node.js menjalankan **dua hal sekaligus**:
1. **Bot Telegram** (polling) — menangani semua interaksi pelanggan
2. **REST API** (Express) — melayani dashboard dan halaman publik

API server selalu di-start **lebih dulu** sebelum bot Telegram diinisialisasi, supaya Railway health check (`/health`) langsung bisa diakses tanpa menunggu bot selesai connect.

### Frontend (Vercel)
Satu project Vite dengan **routing manual berbasis path** (tanpa React Router):

| Path | Halaman | Butuh Login? |
|------|---------|---------------|
| `/` | Landing page toko | Tidak |
| `/stock` | Cek stok real-time | Tidak |
| `/login` | Form login admin | Tidak |
| `/dashboard` | Dashboard admin | Ya — otomatis redirect ke `/login` jika belum login |

`vercel.json` me-rewrite semua path ke `index.html` agar SPA routing bekerja tanpa 404 saat diakses langsung.

### Keamanan Endpoint API
| Jenis | Endpoint | Keterangan |
|-------|----------|------------|
| Publik | `GET /health`, `GET /api/public/stock`, `GET /api/public/bot-info` | Tidak butuh token, hanya data aman |
| Publik | `POST /webhook/pakasir` | Verifikasi internal dari Pakasir, bukan dari user |
| Login | `POST /api/auth/login` | Mengeluarkan JWT token |
| Terproteksi | Semua endpoint `/api/...` lainnya | Wajib `Authorization: Bearer <token>` |
| Admin-only | `/api/dashboard-users`, `/api/logs` | Wajib role `admin` |

---

## Instalasi

### 1. Bot + API (Backend)
```bash
cd telegram-bot-shop
npm install
cp .env.example .env
# Edit .env — isi BOT_TOKEN, ADMIN_IDS, JWT_SECRET minimal
npm start
```

### 2. Dashboard (Frontend)
```bash
cd dashboard
npm install
cp .env.example .env.local
# Edit .env.local — isi VITE_API_BASE dengan URL backend kamu
npm run dev
# Buka http://localhost:5173
```

---

## Konfigurasi Environment Variables

### Backend (`.env` di root, untuk Railway)

```env
# ── Telegram Bot (wajib) ──────────────────────────
BOT_TOKEN=token_dari_botfather
ADMIN_IDS=123456789,987654321

# ── Auth Dashboard (wajib) ─────────────────────────
JWT_SECRET=string_acak_panjang_dan_rahasia

# ── Pakasir Payment Gateway (opsional) ─────────────
PAKASIR_PROJECT=slug_proyek_kamu
PAKASIR_API_KEY=api_key_dari_pakasir

# ── App URL untuk webhook Pakasir ──────────────────
APP_URL=https://nama-project.up.railway.app

# ── Halaman Cek Stok Publik ────────────────────────
STOCK_PAGE_URL=https://nama-project.vercel.app/stock

# ── Dashboard Admin default (opsional) ─────────────
# Mencegah credentials reset ke admin/admin123 setiap redeploy
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password_aman_kamu

# PORT otomatis diisi oleh Railway, tidak perlu diset manual
```

### Dashboard (`.env.local` di folder `dashboard/`, untuk Vercel)

```env
VITE_API_BASE=https://nama-project.up.railway.app
```

> Dashboard **tidak lagi memakai API key statis** — autentikasi sepenuhnya lewat login username/password yang menghasilkan JWT token.

---

## Perintah Bot

Pelanggan **tidak perlu mengetik command apapun** — semua menu berbasis tombol setelah `/start`. Command teks hanya tersedia untuk admin:

| Command | Akses | Fungsi |
|---------|-------|--------|
| `/start` | Semua | Tampilkan menu utama dengan tombol |
| `/addproduct Nama\|Harga\|Deskripsi\|yes/no` | Admin | Tambah produk baru (parameter terakhir = pre-order only) |
| `/addstock Nama\|data1,data2` | Admin | Tambah stok massal untuk satu produk |
| `/confirm ORDER_ID` | Admin | Konfirmasi pembayaran manual, kirim stok acak ke pelanggan |
| `/rejectorder ORDER_ID` | Admin | Tolak/batalkan pesanan |
| `/orders` | Admin | Lihat semua pesanan pending |
| `/stocklist` | Admin | Lihat ringkasan stok semua produk |
| `/addtrigger /perintah\|Teks balasan` | Admin | Tambah command custom |
| `/deltrigger /perintah` | Admin | Hapus command custom |
| `/triggers` | Admin | Lihat semua trigger aktif |
| `/broadcast Pesan` | Admin | Kirim pengumuman ke semua pelanggan |
| `/report` | Admin | Lihat laporan harian |
| `/autoorder on/off` | Admin | Toggle pengiriman stok otomatis |
| `/hidetag Pesan` | Admin | Kirim pesan tanpa menampilkan username pengirim |

### Upload foto via caption
| Caption Foto | Fungsi |
|---|---|
| `/setpay Teks info pembayaran` | Set foto QR QRIS manual + teks instruksi pembayaran |
| `/settriggerpic /perintah` | Tambahkan foto ke command custom yang sudah ada |

---

## Halaman Dashboard

| Halaman | Akses | Isi |
|---------|-------|-----|
| **Dashboard** | Admin, Member | Statistik harian, grafik pendapatan, order pending |
| **Pesanan** | Admin, Member | Daftar pesanan dengan filter status, catatan pelanggan, konfirmasi/tolak |
| **Produk** | Admin, Member | Tambah produk, edit harga inline, hapus produk |
| **Stok** | Admin, Member | Tambah stok massal, filter per produk dan status |
| **Triggers** | Admin, Member | Kelola command custom bot |
| **Broadcast** | Admin, Member | Kirim pengumuman massal dengan laporan detail kegagalan |
| **Laporan** | Admin, Member | Grafik 30 hari, produk terlaris |
| **Log Akses** | Admin saja | Riwayat aktivitas semua user dashboard |
| **Users** | Admin saja | Kelola akun dashboard (tambah/edit/hapus, atur role) |
| **Pengaturan** | Admin, Member | Status Pakasir, link bot, custom greeting, status koneksi, ganti password, info pembayaran, link halaman stok publik |

---

## Setup Pakasir (Payment Gateway)

1. Daftar di [pakasir.com](https://pakasir.com), buat **Proyek** baru, catat **Slug** dan **API Key**
2. Set di Railway Variables:
   ```
   PAKASIR_PROJECT=slug_proyek
   PAKASIR_API_KEY=api_key_kamu
   APP_URL=https://nama-project.up.railway.app
   ```
3. Di Pakasir Dashboard → **Edit Proyek** → isi **Webhook URL**:
   ```
   https://nama-project.up.railway.app/webhook/pakasir
   ```
4. Redeploy Railway. Cek status di dashboard → **Pengaturan** → card **Pakasir Payment Gateway**

### Flow pembayaran otomatis
```
Pelanggan pilih produk → catatan opsional → pilih QRIS/VA
  → Bot kirim QR code / nomor VA langsung di chat
  → Pelanggan bayar
  → Pakasir kirim webhook ke backend
  → Stok dikirim otomatis + admin dapat notifikasi
```

---

## Deploy ke Railway + Vercel

### Railway (Backend)
1. Buat project baru, hubungkan ke repo backend (folder root, **tanpa** folder `dashboard/`)
2. Set semua environment variables di atas
3. Pastikan **Health Check Path** di Settings diisi `/health`
4. Deploy — cek log harus muncul `Server started successfully`

### Vercel (Dashboard)
1. Buat project baru, hubungkan ke repo dashboard, set **Root Directory** ke `dashboard`
2. Set environment variable `VITE_API_BASE` ke URL Railway kamu
3. Deploy — `vercel.json` otomatis menangani routing SPA

> Backend dan frontend di-deploy sebagai **dua repo terpisah** — backend ke Railway, dashboard ke Vercel.

---

## Keamanan

- **Password di-hash** (SHA-256 + salt), tidak pernah disimpan plain text
- **Token JWT** expired otomatis setelah 24 jam
- **Data dashboard users disimpan di file terpisah** (`dashboard_users.json`), tidak ikut campur dengan data transaksi
- **Endpoint publik hanya expose data aman** — nama produk, harga, status stok. Data akun/password stok **tidak pernah** bisa diakses tanpa login
- **Role-based access control** — fitur sensitif (kelola user, lihat log) dibatasi khusus role `admin`
- **Log audit lengkap** — semua aksi tercatat dengan siapa, kapan, dan detail aksinya

---

## Troubleshooting

**Bot tidak merespon `/start`**
Pastikan `BOT_TOKEN` benar dan bot belum diblokir oleh Telegram (cek log Railway).

**Dashboard tidak bisa login**
- Cek `VITE_API_BASE` di Vercel sudah benar dan tanpa trailing slash
- Cek `JWT_SECRET` di Railway sudah diset
- Default akun: `admin` / `admin123` (atau sesuai `ADMIN_USERNAME`/`ADMIN_PASSWORD` jika diset)

**User dashboard hilang setelah redeploy**
Railway tidak punya persistent storage secara default. Set `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di Railway Variables supaya akun admin selalu konsisten meski redeploy, atau gunakan Railway Volume untuk penyimpanan permanen.

**Tombol "Cek Stok Real-time" bilang belum diatur**
Set `STOCK_PAGE_URL` di Railway Variables, isi dengan URL Vercel kamu + `/stock`.

**Broadcast gagal ke sebagian pelanggan**
Normal — biasanya karena pelanggan sudah memblokir bot atau belum pernah `/start`. Lihat detail alasan gagal di hasil broadcast pada dashboard.

**Webhook Pakasir tidak memicu pengiriman stok otomatis**
Cek URL webhook di Pakasir Dashboard sudah benar (`APP_URL/webhook/pakasir`) dan `APP_URL` di Railway sudah diisi tanpa trailing slash.
