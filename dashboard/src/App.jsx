import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";
const API_KEY = import.meta.env.VITE_API_KEY || "";

const api = async (path, method = "GET", body = null) => {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const formatIDR = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n || 0);

const STATUS_COLORS = {
  pending: { bg: "#FEF3C7", text: "#92400E", label: "Menunggu" },
  delivered: { bg: "#D1FAE5", text: "#065F46", label: "Terkirim" },
  cancelled: { bg: "#FEE2E2", text: "#991B1B", label: "Dibatalkan" },
  preorder: { bg: "#EDE9FE", text: "#5B21B6", label: "Pre-Order" },
  paid: { bg: "#DBEAFE", text: "#1E3A8A", label: "Lunas" },
};

function Badge({ status }) {
  const s = STATUS_COLORS[status] || { bg: "#F3F4F6", text: "#374151", label: status };
  return (
    <span style={{ background: s.bg, color: s.text, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function StatCard({ icon, label, value, sub, color = "#6366F1" }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "20px 24px", border: "1px solid #F1F5F9", display: "flex", gap: 16, alignItems: "center" }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: "#94A3B8" }}>{sub}</div>}
      </div>
    </div>
  );
}

function MiniChart({ data }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const w = 400, h = 100, pad = 8;
  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (d.revenue / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 80 }}>
      <polyline points={points.join(" ")} fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = pad + (i / (data.length - 1)) * (w - pad * 2);
        const y = h - pad - (d.revenue / max) * (h - pad * 2);
        return <circle key={i} cx={x} cy={y} r="3" fill="#6366F1" />;
      })}
    </svg>
  );
}

// ──────────────────── PAGES ────────────────────

function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    api("/api/stats").then(setStats).catch(console.error);
    api("/api/revenue?days=7").then(setChart).catch(console.error);
    api("/api/orders?status=pending").then(setOrders).catch(console.error);
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 24 }}>Dashboard</h1>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <StatCard icon="💰" label="Pendapatan Hari Ini" value={formatIDR(stats.revenue_today)} color="#10B981" />
          <StatCard icon="📦" label="Terjual Hari Ini" value={stats.sold_today} color="#6366F1" />
          <StatCard icon="⏳" label="Order Pending" value={stats.pending_orders} color="#F59E0B" />
          <StatCard icon="👤" label="Total User" value={stats.total_users} color="#3B82F6" />
          <StatCard icon="📋" label="Pre-Order" value={stats.preorders} color="#8B5CF6" />
          <StatCard icon="📦" label="Stok Tersisa" value={stats.total_stock} color="#06B6D4" />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Pendapatan 7 Hari</div>
          <MiniChart data={chart} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {chart.map((d) => (
              <div key={d.date} style={{ fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                {d.date?.slice(5)}
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Order Pending ({orders.length})</div>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {orders.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: 20 }}>Tidak ada order pending 🎉</div>
            ) : (
              orders.slice(0, 5).map((o) => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F8FAFC" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{o.product_name}</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>@{o.username} · {o.id}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#10B981" }}>{formatIDR(o.price)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter === "all" ? "" : `?status=${filter}`;
    api(`/api/orders${q}`).then(setOrders).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const confirm = async (id) => {
    setActionId(id);
    try { await api(`/api/orders/${id}/confirm`, "PUT"); load(); } catch (e) { alert("Error: " + e.message); }
    setActionId(null);
  };
  const reject = async (id) => {
    if (!window.confirm("Batalkan order ini?")) return;
    setActionId(id);
    try { await api(`/api/orders/${id}/reject`, "PUT"); load(); } catch (e) { alert("Error: " + e.message); }
    setActionId(null);
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Pesanan</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", "pending", "delivered", "cancelled", "preorder"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid", cursor: "pointer", fontSize: 13, fontWeight: 500, background: filter === s ? "#6366F1" : "#fff", color: filter === s ? "#fff" : "#64748B", borderColor: filter === s ? "#6366F1" : "#E2E8F0" }}>
            {s === "all" ? "Semua" : STATUS_COLORS[s]?.label || s}
          </button>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #F1F5F9", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Order ID", "User", "Produk", "Harga", "Tipe", "Status", "Tanggal", "Aksi"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#64748B", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>Memuat...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>Tidak ada pesanan</td></tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontWeight: 600, color: "#6366F1" }}>{o.id}</td>
                    <td style={{ padding: "12px 16px", color: "#374151" }}>@{o.username}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>{o.product_name}</td>
                    <td style={{ padding: "12px 16px", color: "#10B981", fontWeight: 600 }}>{formatIDR(o.price)}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 11, color: "#94A3B8" }}>{o.type || "normal"}</span></td>
                    <td style={{ padding: "12px 16px" }}><Badge status={o.status} /></td>
                    <td style={{ padding: "12px 16px", color: "#94A3B8", whiteSpace: "nowrap" }}>{new Date(o.created_at).toLocaleDateString("id-ID")}</td>
                    <td style={{ padding: "12px 16px" }}>
                      {o.status === "pending" && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirm(o.id)} disabled={actionId === o.id} style={{ padding: "4px 12px", background: "#10B981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            ✓ Konfirmasi
                          </button>
                          <button onClick={() => reject(o.id)} disabled={actionId === o.id} style={{ padding: "4px 12px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            ✕ Tolak
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", description: "", preorder_only: false });

  const load = () => api("/api/products").then(setProducts).catch(console.error);
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.price) return alert("Nama dan harga wajib diisi!");
    await api("/api/products", "POST", { ...form, price: parseInt(form.price.replace(/\D/g, "")) });
    setForm({ name: "", price: "", description: "", preorder_only: false });
    setShowForm(false);
    load();
  };

  const del = async (id, name) => {
    if (!window.confirm(`Hapus produk "${name}"?`)) return;
    await api(`/api/products/${id}`, "DELETE");
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A" }}>Produk</h1>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "10px 20px", background: "#6366F1", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
          + Tambah Produk
        </button>
      </div>
      {showForm && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #E2E8F0", marginBottom: 20 }}>
          <h3 style={{ marginBottom: 16, color: "#0F172A", fontSize: 16, fontWeight: 600 }}>Produk Baru</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Nama Produk *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Netflix Premium" style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Harga (IDR) *</label>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="50000" style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Deskripsi</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Deskripsi produk..." style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="preorder" checked={form.preorder_only} onChange={(e) => setForm({ ...form, preorder_only: e.target.checked })} />
              <label htmlFor="preorder" style={{ fontSize: 13, color: "#374151" }}>Pre-Order Only (tidak butuh stok tersedia)</label>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={save} style={{ padding: "10px 20px", background: "#10B981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Simpan</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", background: "#F1F5F9", color: "#64748B", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Batal</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {products.map((p) => (
          <div key={p.id} style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #F1F5F9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#0F172A" }}>{p.name}</div>
              {p.preorder_only && <span style={{ background: "#EDE9FE", color: "#7C3AED", fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>PRE-ORDER</span>}
            </div>
            {p.description && <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>{p.description}</div>}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#10B981" }}>{formatIDR(p.price)}</div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                Stok: <strong style={{ color: p.stock_count > 0 ? "#10B981" : "#EF4444" }}>{p.stock_count}</strong>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={() => del(p.id, p.name)} style={{ flex: 1, padding: "6px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StockPage() {
  const [products, setProducts] = useState([]);
  const [allStock, setAllStock] = useState([]);
  const [selectedProd, setSelectedProd] = useState("");
  const [stockInput, setStockInput] = useState("");
  const [filter, setFilter] = useState("available");

  const load = () => {
    api("/api/products").then(setProducts);
    api("/api/stock").then(setAllStock);
  };
  useEffect(() => { load(); }, []);

  const addStock = async () => {
    if (!selectedProd || !stockInput.trim()) return alert("Pilih produk dan masukkan data stok!");
    const items = stockInput.split("\n").map((s) => s.trim()).filter(Boolean);
    await api("/api/stock", "POST", { product_id: selectedProd, items });
    setStockInput("");
    load();
    alert(`✅ ${items.length} item stok ditambahkan!`);
  };

  const del = async (id) => {
    await api(`/api/stock/${id}`, "DELETE");
    load();
  };

  const filtered = allStock.filter((s) => filter === "all" ? true : filter === "available" ? !s.sold : s.sold);

  const getProdName = (id) => products.find((p) => p.id === id)?.name || id;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Manajemen Stok</h1>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9", marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Tambah Stok</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12, alignItems: "flex-start" }}>
          <div>
            <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Produk</label>
            <select value={selectedProd} onChange={(e) => setSelectedProd(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14 }}>
              <option value="">-- Pilih Produk --</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Data Stok (1 per baris)</label>
            <textarea value={stockInput} onChange={(e) => setStockInput(e.target.value)} placeholder={"email:password123\nemail2:password456\nemail3:password789"} rows={4} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          <div style={{ paddingTop: 22 }}>
            <button onClick={addStock} style={{ padding: "10px 20px", background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
              + Tambah
            </button>
          </div>
        </div>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #F1F5F9", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", flex: 1 }}>Daftar Stok</span>
          {["available", "sold", "all"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 12px", borderRadius: 16, border: "1px solid", fontSize: 12, cursor: "pointer", background: filter === f ? "#6366F1" : "#fff", color: filter === f ? "#fff" : "#64748B", borderColor: filter === f ? "#6366F1" : "#E2E8F0" }}>
              {f === "available" ? "Tersedia" : f === "sold" ? "Terjual" : "Semua"}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", color: "#64748B", fontWeight: 600 }}>Produk</th>
                <th style={{ padding: "10px 16px", textAlign: "left", color: "#64748B", fontWeight: 600 }}>Data</th>
                <th style={{ padding: "10px 16px", textAlign: "left", color: "#64748B", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "10px 16px", textAlign: "left", color: "#64748B", fontWeight: 600 }}>Tanggal</th>
                <th style={{ padding: "10px 16px", color: "#64748B", fontWeight: 600 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "10px 16px", fontWeight: 500 }}>{getProdName(s.product_id)}</td>
                  <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 12, color: "#374151", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.sold ? "●●●●●●●●" : s.data}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ background: s.sold ? "#FEE2E2" : "#D1FAE5", color: s.sold ? "#991B1B" : "#065F46", padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {s.sold ? "Terjual" : "Tersedia"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px", color: "#94A3B8" }}>{new Date(s.added_at).toLocaleDateString("id-ID")}</td>
                  <td style={{ padding: "10px 16px", textAlign: "center" }}>
                    {!s.sold && (
                      <button onClick={() => del(s.id)} style={{ padding: "3px 10px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>Tidak ada stok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TriggersPage() {
  const [triggers, setTriggers] = useState([]);
  const [form, setForm] = useState({ trigger: "", response: "" });
  const [showForm, setShowForm] = useState(false);

  const load = () => api("/api/triggers").then(setTriggers);
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.trigger || !form.response) return alert("Trigger dan balasan wajib diisi!");
    await api("/api/triggers", "POST", form);
    setForm({ trigger: "", response: "" });
    setShowForm(false);
    load();
  };

  const del = async (trigger) => {
    if (!window.confirm(`Hapus trigger "${trigger}"?`)) return;
    await api(`/api/triggers/${encodeURIComponent(trigger)}`, "DELETE");
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A" }}>Trigger & Command</h1>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "10px 20px", background: "#6366F1", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
          + Tambah Trigger
        </button>
      </div>
      <div style={{ background: "#F0FDF4", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid #BBF7D0" }}>
        <div style={{ fontSize: 13, color: "#166534", fontWeight: 600, marginBottom: 4 }}>💡 Cara menambahkan foto ke trigger:</div>
        <div style={{ fontSize: 12, color: "#16A34A" }}>Di Telegram: kirim foto dengan caption <code>/settriggerpic /perintah</code></div>
        <div style={{ fontSize: 12, color: "#16A34A", marginTop: 2 }}>Untuk QR pembayaran: kirim foto dengan caption <code>/setpay Teks info pembayaran...</code></div>
      </div>
      {showForm && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #E2E8F0", marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Trigger Baru</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Kata Trigger *</label>
              <input value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} placeholder="/pay atau /info" style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Teks Balasan *</label>
              <textarea value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} placeholder="Teks yang akan dikirimkan bot..." rows={3} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={save} style={{ padding: "10px 20px", background: "#10B981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Simpan</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", background: "#F1F5F9", color: "#64748B", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Batal</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        {triggers.map((t) => (
          <div key={t.trigger} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #F1F5F9", display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ background: "#EEF2FF", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "#6366F1", whiteSpace: "nowrap" }}>
              {t.trigger}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{t.response?.substring(0, 100) || "(kosong)"}{t.response?.length > 100 ? "..." : ""}</div>
              {t.photo_file_id && <span style={{ fontSize: 11, background: "#EDE9FE", color: "#7C3AED", padding: "2px 8px", borderRadius: 10, marginTop: 4, display: "inline-block" }}>🖼 Ada Foto</span>}
            </div>
            <button onClick={() => del(t.trigger)} style={{ padding: "4px 12px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
              Hapus
            </button>
          </div>
        ))}
        {triggers.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#94A3B8", background: "#fff", borderRadius: 16, border: "1px solid #F1F5F9" }}>
            Belum ada trigger. Tambahkan dengan tombol di atas.
          </div>
        )}
      </div>
    </div>
  );
}

function BroadcastPage() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [users, setUsers] = useState([]);

  useEffect(() => { api("/api/users").then(setUsers).catch(console.error); }, []);

  const send = async () => {
    if (!message.trim()) return alert("Pesan tidak boleh kosong!");
    if (!window.confirm(`Kirim broadcast ke ${users.length} user?`)) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api("/api/broadcast", "POST", { message });
      setResult(res);
    } catch (e) { alert("Error: " + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Broadcast Pesan</h1>
      <div style={{ background: "#FFF7ED", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid #FED7AA" }}>
        <div style={{ fontSize: 13, color: "#9A3412", fontWeight: 600 }}>⚠️ Perhatian</div>
        <div style={{ fontSize: 12, color: "#C2410C", marginTop: 2 }}>Broadcast akan dikirim ke semua {users.length} user. Gunakan dengan bijak untuk menghindari spam.</div>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9" }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>
            Pesan Broadcast ({users.length} penerima)
          </label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tulis pesan yang akan dikirimkan ke semua user...\n\nSupport format Markdown: *bold*, _italic_, `code`" rows={6} style={{ width: "100%", padding: "12px", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 14, lineHeight: 1.6, boxSizing: "border-box", resize: "vertical" }} />
        </div>
        <div style={{ background: "#F8FAFC", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: "#64748B" }}>
          <strong>Preview:</strong><br />
          📢 <strong>Pengumuman</strong><br /><br />
          {message || "(tulis pesan di atas)"}
        </div>
        <button onClick={send} disabled={loading} style={{ padding: "12px 28px", background: loading ? "#94A3B8" : "#EF4444", color: "#fff", border: "none", borderRadius: 10, cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 15 }}>
          {loading ? "⏳ Mengirim..." : `📢 Kirim ke ${users.length} User`}
        </button>
        {result && (
          <div style={{ marginTop: 16, padding: 16, background: "#D1FAE5", borderRadius: 10, fontSize: 14, color: "#065F46" }}>
            ✅ Broadcast selesai! <strong>{result.sent}</strong> berhasil, <strong>{result.failed}</strong> gagal.
          </div>
        )}
      </div>
    </div>
  );
}

function ReportPage() {
  const [report, setReport] = useState(null);
  const [chart, setChart] = useState([]);

  useEffect(() => {
    api("/api/report/daily").then(setReport);
    api("/api/revenue?days=30").then(setChart);
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Laporan</h1>
      {report && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
          <StatCard icon="💰" label="Pendapatan Hari Ini" value={formatIDR(report.revenue)} color="#10B981" />
          <StatCard icon="📦" label="Terjual" value={report.sold} color="#6366F1" />
          <StatCard icon="🆕" label="Order Baru" value={report.new_orders} color="#3B82F6" />
          <StatCard icon="❌" label="Dibatalkan" value={report.cancelled} color="#EF4444" />
          <StatCard icon="📋" label="Pre-Order" value={report.preorders} color="#8B5CF6" />
        </div>
      )}
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9", marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Pendapatan 30 Hari</div>
        <MiniChart data={chart} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          {chart.filter((_, i) => i % 6 === 0).map((d) => (
            <div key={d.date} style={{ fontSize: 10, color: "#94A3B8" }}>{d.date?.slice(5)}</div>
          ))}
        </div>
      </div>
      {report?.top_products?.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>🏆 Produk Terlaris Hari Ini</div>
          {report.top_products.map((p, i) => (
            <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: ["#FEF3C7", "#DBEAFE", "#D1FAE5"][i] || "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{i + 1}</div>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
              </div>
              <span style={{ fontWeight: 700, color: "#6366F1" }}>{p.count}x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState({ auto_order: false });
  const [payment, setPayment] = useState(null);
  const [payText, setPayText] = useState("");
  const [saved, setSaved] = useState(false);
  const [apiKey, setApiKey] = useState(API_KEY);

  useEffect(() => {
    api("/api/settings").then(setSettings).catch(console.error);
    api("/api/payment").then((p) => { setPayment(p); if (p?.text) setPayText(p.text); }).catch(console.error);
  }, []);

  const saveSettings = async () => {
    await api("/api/settings", "PUT", settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const savePayment = async () => {
    await api("/api/payment", "PUT", { text: payText });
    alert("✅ Info pembayaran disimpan! Untuk mengubah foto QR, kirim foto dengan caption /setpay di Telegram.");
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Pengaturan</h1>
      <div style={{ display: "grid", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#0F172A" }}>Koneksi API Dashboard</h3>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>API Base URL</label>
            <input defaultValue={API_BASE} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>API Key</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginTop: 12, padding: 12, background: "#F0FDF4", borderRadius: 8, fontSize: 12, color: "#16A34A" }}>
            Pastikan <code>DASHBOARD_API_KEY</code> di file <code>.env</code> bot sama dengan API key di sini.
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#0F172A" }}>Bot Settings</h3>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #F8FAFC" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>Auto-Order</div>
              <div style={{ fontSize: 12, color: "#94A3B8" }}>Otomatis kirim stok setelah pembayaran terdeteksi</div>
            </div>
            <div onClick={() => setSettings({ ...settings, auto_order: !settings.auto_order })} style={{ width: 44, height: 24, borderRadius: 12, background: settings.auto_order ? "#6366F1" : "#E2E8F0", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings.auto_order ? 23 : 3, transition: "left 0.2s" }} />
            </div>
          </div>
          <button onClick={saveSettings} style={{ marginTop: 16, padding: "10px 20px", background: saved ? "#10B981" : "#6366F1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            {saved ? "✅ Tersimpan!" : "Simpan Pengaturan"}
          </button>
        </div>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#0F172A" }}>Info Pembayaran & QR QRIS</h3>
          <div style={{ background: "#EFF6FF", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: "#1D4ED8" }}>
            💡 Untuk set foto QR QRIS: Kirim foto di Telegram dengan caption:<br />
            <code>/setpay [teks info pembayaran]</code>
          </div>
          <label style={{ fontSize: 12, color: "#64748B", display: "block", marginBottom: 6 }}>Teks Info Pembayaran</label>
          <textarea value={payText} onChange={(e) => setPayText(e.target.value)} rows={5} placeholder={"💳 Transfer ke:\nBank BCA: 1234567890\nA/N: Nama Toko\n\nAtau scan QR QRIS di bawah."} style={{ width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
          {payment?.photo_file_id && <div style={{ marginTop: 8, fontSize: 12, color: "#10B981" }}>✅ Foto QR QRIS sudah diset via Telegram</div>}
          <button onClick={savePayment} style={{ marginTop: 12, padding: "10px 20px", background: "#10B981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            Simpan Info Pembayaran
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────── APP ────────────────────

const NAV_ITEMS = [
  { id: "dashboard", icon: "🏠", label: "Dashboard" },
  { id: "orders", icon: "📋", label: "Pesanan" },
  { id: "products", icon: "🛍️", label: "Produk" },
  { id: "stock", icon: "📦", label: "Stok" },
  { id: "triggers", icon: "⚡", label: "Triggers" },
  { id: "broadcast", icon: "📢", label: "Broadcast" },
  { id: "report", icon: "📊", label: "Laporan" },
  { id: "settings", icon: "⚙️", label: "Pengaturan" },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const PAGES = { dashboard: DashboardPage, orders: OrdersPage, products: ProductsPage, stock: StockPage, triggers: TriggersPage, broadcast: BroadcastPage, report: ReportPage, settings: SettingsPage };
  const PageComponent = PAGES[page] || DashboardPage;

  const nav = (id) => { setPage(id); setSidebarOpen(false); };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }} />
      )}
      {/* Sidebar */}
      <aside style={{
        width: 240, background: "#1E1B4B", display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 50,
        transform: sidebarOpen ? "translateX(0)" : undefined,
        transition: "transform 0.25s",
        "@media(max-width:768px)": { transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)" }
      }}
        className="sidebar">
        <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>🤖 ShopBot</div>
          <div style={{ fontSize: 11, color: "#A5B4FC", marginTop: 2 }}>Admin Dashboard</div>
        </div>
        <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
          {NAV_ITEMS.map((item) => (
            <button key={item.id} onClick={() => nav(item.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 20px",
              background: page === item.id ? "rgba(99,102,241,0.3)" : "transparent",
              border: "none", cursor: "pointer", color: page === item.id ? "#C7D2FE" : "#94A3B8",
              fontSize: 14, fontWeight: page === item.id ? 600 : 400, textAlign: "left",
              borderLeft: page === item.id ? "3px solid #6366F1" : "3px solid transparent"
            }}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: 11, color: "#475569" }}>
          Telegram Shop Bot v1.0
        </div>
      </aside>
      {/* Main */}
      <div style={{ flex: 1, marginLeft: 240, display: "flex", flexDirection: "column", minHeight: "100vh" }} className="main-content">
        {/* Topbar mobile */}
        <header style={{ background: "#fff", borderBottom: "1px solid #F1F5F9", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }} className="topbar">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ display: "none", background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4 }} className="hamburger">☰</button>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#64748B" }}>
            {NAV_ITEMS.find((n) => n.id === page)?.icon} {NAV_ITEMS.find((n) => n.id === page)?.label}
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#94A3B8" }}>
            {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </header>
        <main style={{ flex: 1, padding: 24, maxWidth: 1100, width: "100%" }}>
          <PageComponent />
        </main>
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @media (max-width: 768px) {
          .sidebar { transform: translateX(-100%); }
          .sidebar.open { transform: translateX(0); }
          .main-content { margin-left: 0 !important; }
          .hamburger { display: block !important; }
        }
      `}</style>
    </div>
  );
}
