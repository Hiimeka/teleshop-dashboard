#!/bin/bash
# ╔══════════════════════════════════════╗
# ║   ShopBot Auto Setup Script          ║
# ╚══════════════════════════════════════╝

echo ""
echo "🤖 ShopBot Setup"
echo "════════════════"

# Install bot dependencies
echo ""
echo "📦 Install bot dependencies..."
npm install

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  File .env dibuat dari template."
  echo "   Edit .env dan isi BOT_TOKEN dan ADMIN_IDS kamu!"
else
  echo "✅ .env sudah ada"
fi

# Create database directory
mkdir -p database

# Install dashboard dependencies
echo ""
echo "📦 Install dashboard dependencies..."
cd dashboard && npm install && cd ..

echo ""
echo "════════════════════════════════════"
echo "✅ Setup selesai!"
echo ""
echo "Langkah selanjutnya:"
echo "1. Edit .env → isi BOT_TOKEN dan ADMIN_IDS"
echo "2. Jalankan bot:       npm start"
echo "3. Jalankan dashboard: cd dashboard && npm run dev"
echo "4. Buka dashboard:     http://localhost:5173"
echo ""
echo "Dokumentasi lengkap: README.md"
echo ""
