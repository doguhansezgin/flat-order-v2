// FLAT ORDER — panel: Siparişler + Sipariş Gir
import { db, auth, ADMIN_EMAILS } from "./config.js?v=1";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ---------- durum ----------
let currentUser = null, userProfile = null;
let products = [], allOrders = [], adminUsers = [];
let unsubP = null, unsubO = null;
let siteCategories = [];
let openUserUid = null; // üye detay aç/kapa
let activeTab = "orders";
let editingOrderId = null;      // düzenleme modundaki sipariş
let editItems = [];             // düzenleme kopyası
// sipariş gir
let aoCart = {};                // productId -> qty
let aoPrices = {};              // productId -> özel birim fiyat
let aoManual = [];              // manuel kalemler [{name, price, qty, vat, cost?}]
let aoCat = "Tümü";

// ---------- yardımcılar ----------
const $ = id => document.getElementById(id);
const TL = `<span class="tl">₺</span>`;
const fmt = n => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
const vatOf = x => x?.vat ?? 0.20;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS_LABEL = { bekliyor: "Bekliyor", hazirlaniyor: "Hazırlanıyor", "teslim-bekliyor": "Teslim onayı bekliyor", tamamlandi: "Tamamlandı", iptal: "İptal" };
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

function itemTotals(items) {
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalVat = items.reduce((s, i) => s + i.price * i.qty * vatOf(i), 0);
  return { total, totalVat, totalWithVat: total + totalVat };
}

// ---------- giriş kontrolü ----------
window.doLogout = async () => { await signOut(auth); location.href = "index.html"; };

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) { location.href = "index.html"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  userProfile = snap.exists() ? snap.data() : null;
  const isAdmin = ADMIN_EMAILS.includes(user.email) || userProfile?.adminApproved === true;
  if (!isAdmin) { $("denied").style.display = "flex"; return; }
  $("panel").style.display = "block";
  startListeners();
  loadUsers();
});

function startListeners() {
  onSnapshot(collection(db, "siteCategories"), snap => {
    siteCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (activeTab === "products") renderProducts();
  });
  unsubP = onSnapshot(collection(db, "products"), snap => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    products.sort((a, b) => (a.code || "").localeCompare(b.code || "", "tr", { numeric: true }));
    if (activeTab === "neworder") renderNewOrder();
    if (activeTab === "products") renderProducts();
  });
  unsubO = onSnapshot(collection(db, "orders"), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allOrders.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (activeTab === "orders") renderOrders();
  });
}

async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  adminUsers = snap.docs.map(d => d.data()).sort((a, b) => (a.cafe || "").localeCompare(b.cafe || "", "tr"));
  if (activeTab === "neworder") renderNewOrder();
}

// ---------- sekmeler ----------
const TABS = ["orders", "neworder", "products", "users", "reports"];
window.showTab = function (t) {
  activeTab = t;
  TABS.forEach(x => {
    $("tab-" + x)?.classList.toggle("active", x === t);
    const pane = $("pane-" + x);
    if (pane) pane.style.display = x === t ? "block" : "none";
  });
  if (t === "orders") renderOrders();
  if (t === "neworder") renderNewOrder();
  if (t === "products") renderProducts();
  if (t === "users") renderUsers();
  if (t === "reports") renderReports();
};

// =====================================================
// SİPARİŞLER
// =====================================================
function renderOrders() {
  const counts = { bekliyor: 0, hazirlaniyor: 0, "teslim-bekliyor": 0, tamamlandi: 0, iptal: 0 };
  let ciro = 0, eksik = 0;
  allOrders.forEach(o => {
    if (counts[o.status] !== undefined) counts[o.status]++;
    if (o.status === "tamamlandi" || o.status === "teslim-bekliyor") ciro += o.total;
    if (o.deliveryIssue && !o.issueResolved) eksik++;
  });

  const filter = $("f-status")?.value || "hepsi";
  const list = allOrders.filter(o =>
    filter === "hepsi" ||
    (filter === "eksik" ? (o.deliveryIssue && !o.issueResolved) : o.status === filter)
  );

  $("pane-orders").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat-num">${counts.bekliyor}</div><div class="stat-lbl">Bekleyen</div></div>
      <div class="stat"><div class="stat-num">${counts.hazirlaniyor}</div><div class="stat-lbl">Hazırlanıyor</div></div>
      <div class="stat"><div class="stat-num">${counts["teslim-bekliyor"]}</div><div class="stat-lbl">Teslim onayında</div></div>
      <div class="stat ${eksik > 0 ? "alert" : ""}"><div class="stat-num">${eksik}</div><div class="stat-lbl">Eksik bildirim</div></div>
      <div class="stat"><div class="stat-num">${counts.tamamlandi}</div><div class="stat-lbl">Tamamlandı</div></div>
      <div class="stat"><div class="stat-num">${TL}${fmt(ciro)}</div><div class="stat-lbl">Ciro</div></div>
    </div>
    <div class="toolbar">
      <span class="eyebrow">Filtre</span>
      <select class="sel" id="f-status" onchange="renderOrdersKeep()">
        <option value="hepsi" ${filter === "hepsi" ? "selected" : ""}>Tümü</option>
        <option value="bekliyor" ${filter === "bekliyor" ? "selected" : ""}>Bekliyor</option>
        <option value="hazirlaniyor" ${filter === "hazirlaniyor" ? "selected" : ""}>Hazırlanıyor</option>
        <option value="teslim-bekliyor" ${filter === "teslim-bekliyor" ? "selected" : ""}>Teslim onayı bekliyor</option>
        <option value="eksik" ${filter === "eksik" ? "selected" : ""}>Eksik bildirilen</option>
        <option value="tamamlandi" ${filter === "tamamlandi" ? "selected" : ""}>Tamamlandı</option>
        <option value="iptal" ${filter === "iptal" ? "selected" : ""}>İptal</option>
      </select>
    </div>
    ${list.length === 0 ? `<div class="empty">Sipariş yok</div>` : list.map(o =>
      editingOrderId === o.id ? editCard(o) : orderCard(o)
    ).join("")}
    <div style="height:32px"></div>`;
}
window.renderOrdersKeep = () => { const v = $("f-status").value; renderOrders(); $("f-status").value = v; };

function orderCard(o) {
  const hasIssue = o.deliveryIssue && !o.issueResolved;
  const editable = o.status === "bekliyor" || o.status === "hazirlaniyor";
  return `<div class="o-card ${hasIssue ? "issue" : ""}">
    <div class="o-head">
      <span>
        <span class="num" style="font-weight:500">${esc(o.num)}</span>
        <span class="status ${esc(o.status)}" style="margin-left:10px">${STATUS_LABEL[o.status] || esc(o.status)}</span>
        ${hasIssue ? `<span class="status iptal" style="margin-left:8px">Eksik teslimat</span>` : ""}
        ${o.deliveryConfirmed ? `<span class="eyebrow" style="color:var(--ok);margin-left:8px">Müşteri onayladı</span>` : ""}
        ${o.edited ? `<span class="eyebrow" style="margin-left:8px">Düzenlendi</span>` : ""}
      </span>
      <span class="eyebrow">${esc(o.date || "")}</span>
    </div>
    <div class="o-meta">${esc(o.cafe)} · ${esc(o.contact)} · ${esc(o.phone)}</div>
    ${o.note ? `<div class="o-meta">Not: ${esc(o.note)}</div>` : ""}
    <div class="o-items">${(o.items || []).map(i =>
      `${esc(i.name)} ×${i.qty} = ${TL}${fmt(i.price * i.qty)}${i.priceEdited ? `<span class="tag-ozel" title="Liste: ₺${i.listPrice}">ÖZEL</span>` : ""}${i.manual ? `<span class="tag-man">MANUEL</span>` : ""}`
    ).join(" &nbsp;·&nbsp; ")}</div>
    ${hasIssue ? issueBox(o) : ""}
    <div class="o-actions">
      <span class="num" style="font-size:15px;font-weight:500">${TL}${fmt(o.total)}</span>
      <span class="eyebrow num">+${TL}${fmt(o.totalVat || 0)} KDV</span>
      <span style="flex:1"></span>
      <select class="sel" onchange="updateOrderStatus('${o.id}', this.value)">
        <option value="bekliyor" ${o.status === "bekliyor" ? "selected" : ""}>Bekliyor</option>
        <option value="hazirlaniyor" ${o.status === "hazirlaniyor" ? "selected" : ""}>Hazırlanıyor</option>
        <option value="teslim-bekliyor" disabled ${o.status === "teslim-bekliyor" ? "selected" : ""}>Teslim onayı bekliyor</option>
        <option value="tamamlandi" ${o.status === "tamamlandi" ? "selected" : ""}>Tamamlandı</option>
        <option value="iptal" ${o.status === "iptal" ? "selected" : ""}>İptal</option>
      </select>
      ${editable ? `<button class="btn-ghost" onclick="startEdit('${o.id}')">Düzenle</button>` : ""}
      <button class="btn-ghost" onclick="generateProforma('${o.id}')">Proforma</button>
      <button class="btn-ghost" style="border-color:var(--danger);color:var(--danger)" onclick="deleteOrder('${o.id}')">Sil</button>
    </div>
  </div>`;
}

function issueBox(o) {
  return `<div class="issue-box">
    <div class="eyebrow" style="color:var(--danger);margin-bottom:6px">Müşterinin bildirdiği eksikler</div>
    ${(o.missingItems || []).map(m => `<div>No ${esc(m.code || "—")} · ${esc(m.name)} — sipariş ${m.ordered}, gelen <b>${m.received}</b> (eksik ${m.ordered - m.received})</div>`).join("")}
    <div class="note-box">Stok bu siparişte zaten düşüldü. Eksiği yeni sipariş olarak girmeyin — gönderin ve "Çözüldü"ye basın; aksi halde stok ikinci kez düşer.</div>
    <button class="btn-ghost" style="margin-top:10px" onclick="resolveDeliveryIssue('${o.id}')">Çözüldü ve tamamla</button>
  </div>`;
}

// ---------- durum akışı ----------
window.updateOrderStatus = async function (id, status) {
  const order = allOrders.find(o => o.id === id);
  const prev = order?.status;

  if (status === "tamamlandi" && order && prev !== "tamamlandi") {
    if (prev === "teslim-bekliyor") {
      await updateDoc(doc(db, "orders", id), { status: "tamamlandi", deliveryIssue: false, issueResolved: true });
      showToast("Sipariş manuel tamamlandı");
    } else {
      const unstocked = order.items.filter(i => { const p = products.find(x => x.id === i.id); return p && p.unstocked; });
      if (unstocked.length > 0) { showUnstockedModal(order, unstocked); return; }
      await completeOrder(order, null);
    }
    return;
  }

  await updateDoc(doc(db, "orders", id), { status });

  if (status === "iptal" && (prev === "tamamlandi" || prev === "teslim-bekliyor") && order) {
    for (const item of order.items) {
      const p = products.find(x => x.id === item.id);
      if (p) await updateDoc(doc(db, "products", item.id), { stock: (p.stock || 0) + item.qty });
    }
    showToast("İptal edildi, stok iade edildi");
    return;
  }
  showToast("Durum güncellendi");
};

// FIFO: stok girişlerinden kalıcı düşüm yapar, toplam maliyeti döner
async function consumeFIFO(productId, qty) {
  const snap = await getDocs(collection(db, "stockEntries"));
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.productId === productId && (e.remaining ?? e.qty) > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (entries.length === 0) return { costTotal: null, estimated: false };
  let kalan = qty, total = 0;
  for (const e of entries) {
    if (kalan <= 0) break;
    const rem = e.remaining ?? e.qty;
    const take = Math.min(kalan, rem);
    total += take * e.cost;
    await updateDoc(doc(db, "stockEntries", e.id), { remaining: rem - take });
    kalan -= take;
  }
  if (kalan > 0) total += kalan * entries[entries.length - 1].cost; // giriş yetersiz: son maliyetle tahmin
  return { costTotal: total, estimated: kalan > 0 };
}

async function completeOrder(order, unstockedCosts) {
  const itemsWithCost = [];
  for (const item of order.items) {
    const it = { ...item };
    if (it.manual) {
      if (it.cost) it.costTotal = it.cost * it.qty;
    } else {
      const p = products.find(x => x.id === it.id);
      if (p && p.unstocked) {
        const c = unstockedCosts?.[it.id];
        if (c) { it.cost = parseFloat(c); it.costTotal = it.cost * it.qty; }
      } else if (p) {
        await updateDoc(doc(db, "products", it.id), { stock: Math.max(0, (p.stock || 0) - it.qty) });
        const fifo = await consumeFIFO(it.id, it.qty);
        if (fifo.costTotal !== null) { it.costTotal = fifo.costTotal; if (fifo.estimated) it.costEstimated = true; }
      }
    }
    itemsWithCost.push(it);
  }
  await updateDoc(doc(db, "orders", order.id), { status: "teslim-bekliyor", items: itemsWithCost });
  if (order.uid) {
    const uRef = doc(db, "users", order.uid);
    const uSnap = await getDoc(uRef);
    if (uSnap.exists()) {
      const ud = uSnap.data();
      await updateDoc(uRef, { orderCount: (ud.orderCount || 0) + 1, totalSpent: (ud.totalSpent || 0) + order.total });
    }
  }
  showToast("Stok düşüldü, müşteri teslim onayı bekleniyor");
}

function showUnstockedModal(order, items) {
  document.getElementById("umodal")?.remove();
  const m = document.createElement("div");
  m.id = "umodal"; m.className = "modal-bg";
  m.innerHTML = `<div class="modal">
    <div class="section-title">Stoksuz ürün alış fiyatları</div>
    <p style="font-size:13px;color:var(--soft);margin:10px 0 4px">Bu siparişteki stoksuz ürünlerin alış fiyatını girin (rapor için). Boş bırakılabilir.</p>
    ${items.map(i => `
      <label class="lbl">${esc(i.name)} — birim alış (${TL})</label>
      <input class="field" type="number" step="0.01" min="0" id="uc-${i.id}">`).join("")}
    <button class="btn-solid" onclick="confirmUnstocked('${order.id}')">Kaydet ve devam et</button>
    <button class="link" style="margin-top:12px" onclick="document.getElementById('umodal').remove()">Vazgeç</button>
  </div>`;
  document.body.appendChild(m);
  window._pendingUnstocked = { order, items };
}

window.confirmUnstocked = async function (orderId) {
  const { order, items } = window._pendingUnstocked || {};
  if (!order || order.id !== orderId) return;
  const costs = {};
  items.forEach(i => { const v = $("uc-" + i.id)?.value; if (v) costs[i.id] = v; });
  document.getElementById("umodal")?.remove();
  await completeOrder(order, Object.keys(costs).length ? costs : null);
};

window.resolveDeliveryIssue = async function (id) {
  if (!confirm('Eksik ürünler tamamlandı mı? Sipariş "Tamamlandı" olacak.\n\nNot: Stok tekrar düşülmez.')) return;
  await updateDoc(doc(db, "orders", id), { issueResolved: true, deliveryIssue: false, status: "tamamlandi", deliveryConfirmedAt: new Date().toISOString() });
  showToast("Çözüldü, sipariş tamamlandı");
};

window.deleteOrder = async function (id) {
  const order = allOrders.find(o => o.id === id);
  if (!order) return;
  if (!confirm(`${order.num} silinsin mi? Bu işlem geri alınamaz.`)) return;
  if (order.status === "tamamlandi" || order.status === "teslim-bekliyor") {
    for (const item of order.items) {
      if (item.manual) continue;
      const p = products.find(x => x.id === item.id);
      if (p) await updateDoc(doc(db, "products", item.id), { stock: (p.stock || 0) + item.qty });
    }
    if (order.uid) {
      const uRef = doc(db, "users", order.uid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const ud = uSnap.data();
        await updateDoc(uRef, { orderCount: Math.max(0, (ud.orderCount || 0) - 1), totalSpent: Math.max(0, (ud.totalSpent || 0) - order.total) });
      }
    }
  }
  await deleteDoc(doc(db, "orders", id));
  showToast("Sipariş silindi");
};

// ---------- sipariş düzenleme ----------
window.startEdit = function (id) {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  editingOrderId = id;
  editItems = (o.items || []).map(i => ({ ...i }));
  renderOrders();
};

window.cancelEdit = function () { editingOrderId = null; editItems = []; renderOrders(); };

function editCard(o) {
  const t = itemTotals(editItems);
  const inCart = new Set(editItems.filter(i => !i.manual).map(i => i.id));
  const addable = products.filter(p => !inCart.has(p.id));
  return `<div class="o-card" style="border-top-width:2px">
    <div class="o-head">
      <span><span class="num" style="font-weight:500">${esc(o.num)}</span> <span class="eyebrow" style="margin-left:10px">Düzenleniyor</span></span>
      <span class="eyebrow">${esc(o.date || "")}</span>
    </div>
    <div class="o-meta">${esc(o.cafe)}</div>
    <div style="margin-top:10px">
      ${editItems.map((i, idx) => `
        <div class="edit-row">
          <span style="flex:1;min-width:140px">${esc(i.name)}${i.manual ? `<span class="tag-man">MANUEL</span>` : ""}${i.priceEdited ? `<span class="tag-ozel">ÖZEL</span>` : ""}</span>
          <label class="eyebrow">Adet <input type="number" min="1" value="${i.qty}" onchange="editQty(${idx}, this.value)"></label>
          <label class="eyebrow">Birim ${TL}<input type="number" step="0.01" min="0" value="${i.price}" onchange="editPrice(${idx}, this.value)"></label>
          <span class="num" style="min-width:80px;text-align:right">${TL}${fmt(i.price * i.qty)}</span>
          <button class="x-btn" onclick="editRemove(${idx})" aria-label="Kalemi sil">×</button>
        </div>`).join("")}
    </div>
    <div class="toolbar" style="padding-left:0;padding-right:0">
      <select class="sel" id="edit-add-sel">
        <option value="">Katalogdan ekle…</option>
        ${addable.map(p => `<option value="${p.id}">No ${esc(p.code || "—")} · ${esc(p.name)} — ${fmt(p.price)}</option>`).join("")}
      </select>
      <button class="btn-ghost" onclick="editAddCatalog()">Ekle</button>
      <button class="btn-ghost" onclick="editAddManualRow()">Manuel kalem</button>
    </div>
    <div id="edit-manual-form" style="display:none;margin-top:10px;border:0.5px solid var(--hair);padding:12px 14px">
      <div class="eyebrow" style="margin-bottom:4px">Manuel kalem — sadece bu siparişte geçerli, stoğa işlenmez</div>
      <label class="lbl">Ürün adı</label><input class="field" id="em-name">
      <div style="display:flex;gap:18px">
        <span style="flex:1"><label class="lbl">Birim fiyat (${TL}, KDV hariç)</label><input class="field" type="number" step="0.01" min="0" id="em-price"></span>
        <span style="flex:1"><label class="lbl">Adet</label><input class="field" type="number" min="1" value="1" id="em-qty"></span>
        <span style="flex:1"><label class="lbl">KDV %</label><input class="field" type="number" min="0" max="100" value="20" id="em-vat"></span>
      </div>
      <button class="btn-ghost" style="margin-top:12px" onclick="editAddManual()">Kalemi ekle</button>
    </div>
    <div class="o-actions" style="margin-top:14px">
      <span class="num" style="font-size:15px;font-weight:500">${TL}${fmt(t.total)}</span>
      <span class="eyebrow num">+${TL}${fmt(t.totalVat)} KDV = ${TL}${fmt(t.totalWithVat)}</span>
      <span style="flex:1"></span>
      <button class="btn-ghost" onclick="cancelEdit()">Vazgeç</button>
      <button class="btn-ghost" style="background:var(--ink);color:var(--paper)" onclick="saveEdit('${o.id}')">Kaydet</button>
    </div>
  </div>`;
}

window.editQty = (idx, v) => { const n = parseInt(v, 10); editItems[idx].qty = isNaN(n) || n < 1 ? 1 : n; renderOrders(); };
window.editPrice = (idx, v) => {
  const p = num(v);
  editItems[idx].price = p;
  if (!editItems[idx].manual) {
    const cat = products.find(x => x.id === editItems[idx].id);
    if (cat && p !== cat.price) { editItems[idx].priceEdited = true; editItems[idx].listPrice = cat.price; }
    else { delete editItems[idx].priceEdited; delete editItems[idx].listPrice; }
  }
  editItems[idx].vatAmount = editItems[idx].price * editItems[idx].qty * vatOf(editItems[idx]);
  renderOrders();
};
window.editRemove = idx => { editItems.splice(idx, 1); renderOrders(); };

window.editAddCatalog = function () {
  const id = $("edit-add-sel")?.value;
  if (!id) return;
  const p = products.find(x => x.id === id);
  if (!p) return;
  editItems.push({ id: p.id, code: p.code, name: p.name, qty: 1, price: p.price, vat: vatOf(p), vatAmount: p.price * vatOf(p) });
  renderOrders();
};

window.editAddManualRow = function () {
  const f = $("edit-manual-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
};

window.editAddManual = function () {
  const name = $("em-name").value.trim();
  const price = num($("em-price").value);
  const qty = Math.max(1, parseInt($("em-qty").value, 10) || 1);
  const vat = Math.max(0, num($("em-vat").value)) / 100;
  if (!name || price <= 0) { showToast("Ad ve fiyat gerekli"); return; }
  editItems.push({ manual: true, code: "MNL", name, qty, price, vat, vatAmount: price * qty * vat });
  renderOrders();
};

window.saveEdit = async function (id) {
  if (editItems.length === 0) { showToast("Sipariş boş olamaz — silmek için Sil kullanın"); return; }
  const items = editItems.map(i => ({ ...i, vatAmount: i.price * i.qty * vatOf(i) }));
  const t = itemTotals(items);
  await updateDoc(doc(db, "orders", id), {
    items, total: t.total, totalVat: t.totalVat, totalWithVat: t.totalWithVat,
    edited: true, editedAt: new Date().toISOString()
  });
  editingOrderId = null; editItems = [];
  showToast("Sipariş güncellendi");
};

// =====================================================
// SİPARİŞ GİR
// =====================================================
function renderNewOrder() {
  const selUid = $("ao-user")?.value || "";
  const prevSearch = $("ao-search")?.value || "";
  const prevNote = $("ao-note")?.value || "";
  const prevDate = $("ao-date")?.value || new Date().toISOString().slice(0, 10);
  const selectedUser = adminUsers.find(u => u.uid === selUid);

  const cats = ["Tümü", ...new Set(products.map(p => p.cat).filter(Boolean))];
  const q = prevSearch.toLocaleLowerCase("tr");
  let list = aoCat === "Tümü" ? products : products.filter(p => p.cat === aoCat);
  if (q) list = list.filter(p => (p.name || "").toLocaleLowerCase("tr").includes(q));

  const sumIds = Object.keys(aoCart);
  const sumTotal = sumIds.reduce((s, id) => { const p = products.find(x => x.id === id); return s + (p ? aoPrice(p) * aoCart[id] : 0); }, 0)
    + aoManual.reduce((s, m) => s + m.price * m.qty, 0);

  $("pane-neworder").innerHTML = `
  <div class="ao-grid">
    <div>
      <div class="section" style="padding-bottom:0">
        <div class="section-title">Müşteri</div>
        <select class="sel" id="ao-user" style="width:100%;margin-top:8px" onchange="renderNewOrderKeep()">
          <option value="">Müşteri seçin…</option>
          ${adminUsers.map(u => `<option value="${u.uid}" ${u.uid === selUid ? "selected" : ""}>${esc(u.cafe)} — ${esc(u.name)}</option>`).join("")}
        </select>
        ${selectedUser ? `<div class="o-meta" style="margin-top:8px">${esc(selectedUser.phone || "")} · ${esc(selectedUser.email || "")}</div>` : ""}
        <label class="lbl" for="ao-date">Sipariş tarihi</label>
        <input class="field" type="date" id="ao-date" value="${prevDate}">
        <label class="lbl" for="ao-note">Not</label>
        <textarea class="field" id="ao-note">${esc(prevNote)}</textarea>
      </div>
      <div class="section">
        <div class="section-title">Ürünler</div>
        <input class="field" id="ao-search" placeholder="Ürün ara" value="${esc(prevSearch)}" oninput="renderNewOrderKeep()">
        <div class="cats" style="padding:12px 0 0">
          ${cats.map(c => `<button class="cat ${c === aoCat ? "active" : ""}" onclick="setAoCat('${esc(c)}')">${esc(c)}</button>`).join("")}
        </div>
        <div class="ao-list" style="margin-top:6px">
          ${list.map(p => {
            const qty = aoCart[p.id] || 0;
            return `<div class="ao-item">
              <div class="ao-item-info">
                <div class="eyebrow">No ${esc(p.code || "—")} · ${esc(p.cat || "")}</div>
                <div>${esc(p.name)} <span class="num" style="color:var(--soft)">— ${TL}${fmt(p.price)}</span></div>
              </div>
              <span class="qty" style="margin:0">
                <button onclick="aoDec('${p.id}')" aria-label="Azalt">−</button>
                <input type="number" min="0" value="${qty}" onchange="aoSet('${p.id}', this.value)" aria-label="Adet">
                <button onclick="aoInc('${p.id}')" aria-label="Artır">+</button>
              </span>
            </div>`;
          }).join("")}
        </div>
        <div style="margin-top:16px;border:0.5px solid var(--hair);padding:12px 14px">
          <div class="eyebrow" style="margin-bottom:4px">Manuel kalem — sadece bu siparişte, stoğa işlenmez</div>
          <label class="lbl">Ürün adı</label><input class="field" id="am-name">
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            <span style="flex:1;min-width:100px"><label class="lbl">Birim ${TL} (KDV hariç)</label><input class="field" type="number" step="0.01" min="0" id="am-price"></span>
            <span style="flex:1;min-width:70px"><label class="lbl">Adet</label><input class="field" type="number" min="1" value="1" id="am-qty"></span>
            <span style="flex:1;min-width:70px"><label class="lbl">KDV %</label><input class="field" type="number" min="0" max="100" value="20" id="am-vat"></span>
            <span style="flex:1;min-width:100px"><label class="lbl">Alış ${TL} (ops.)</label><input class="field" type="number" step="0.01" min="0" id="am-cost"></span>
          </div>
          <button class="btn-ghost" style="margin-top:12px" onclick="aoAddManual()">Kalemi ekle</button>
        </div>
      </div>
    </div>

    <div>
      <div class="section">
        <div class="section-title">Sipariş özeti</div>
        ${sumIds.length === 0 && aoManual.length === 0 ? `<div class="empty" style="padding:24px 0">Henüz ürün yok</div>` : ""}
        ${sumIds.map(id => {
          const p = products.find(x => x.id === id); if (!p) return "";
          const pr = aoPrice(p);
          const edited = aoPrices[id] !== undefined;
          return `<div class="sum-row">
            <span style="flex:1;min-width:0">${esc(p.name)} ×${aoCart[id]}${edited ? `<span class="tag-ozel">ÖZEL</span>` : ""}</span>
            <span style="display:flex;align-items:center;gap:4px">${TL}<input type="number" step="0.01" min="0" value="${pr}" onchange="aoSetPrice('${p.id}', this.value)" title="Birim fiyat (liste ₺${p.price})"></span>
            <span class="num" style="min-width:76px;text-align:right;font-weight:500">${TL}${fmt(pr * aoCart[id])}</span>
          </div>`;
        }).join("")}
        ${aoManual.map((m, idx) => `<div class="sum-row">
            <span style="flex:1;min-width:0">${esc(m.name)} ×${m.qty}<span class="tag-man">MANUEL</span></span>
            <span class="num">${TL}${fmt(m.price)}</span>
            <span class="num" style="min-width:76px;text-align:right;font-weight:500">${TL}${fmt(m.price * m.qty)}</span>
            <button class="x-btn" onclick="aoRemoveManual(${idx})" aria-label="Kalemi sil">×</button>
          </div>`).join("")}
        ${(sumIds.length || aoManual.length) ? `
          <div class="total-line"><span>Toplam (KDV hariç)</span><span class="num">${TL}${fmt(sumTotal)}</span></div>
          <button class="btn-solid" onclick="submitAdminOrder()">Siparişi kaydet</button>` : ""}
      </div>
    </div>
  </div>`;
}
window.renderNewOrderKeep = function () {
  const el = $("ao-search");
  const pos = el ? el.selectionStart : null;
  renderNewOrder();
  if (pos !== null) { const n = $("ao-search"); n.focus(); n.setSelectionRange(pos, pos); }
};

function aoPrice(p) { return aoPrices[p.id] !== undefined ? aoPrices[p.id] : p.price; }
window.setAoCat = c => { aoCat = c; renderNewOrder(); };
window.aoInc = id => { aoCart[id] = (aoCart[id] || 0) + 1; renderNewOrder(); };
window.aoDec = id => { aoCart[id] = (aoCart[id] || 1) - 1; if (aoCart[id] <= 0) { delete aoCart[id]; delete aoPrices[id]; } renderNewOrder(); };
window.aoSet = (id, v) => { const n = parseInt(v, 10); if (isNaN(n) || n <= 0) { delete aoCart[id]; delete aoPrices[id]; } else aoCart[id] = n; renderNewOrder(); };
window.aoSetPrice = (id, v) => {
  const p = products.find(x => x.id === id);
  const n = num(v);
  if (n <= 0 || (p && n === p.price)) delete aoPrices[id]; else aoPrices[id] = n;
  renderNewOrder();
};
window.aoAddManual = function () {
  const name = $("am-name").value.trim();
  const price = num($("am-price").value);
  const qty = Math.max(1, parseInt($("am-qty").value, 10) || 1);
  const vat = Math.max(0, num($("am-vat").value)) / 100;
  const cost = num($("am-cost").value);
  if (!name || price <= 0) { showToast("Ad ve fiyat gerekli"); return; }
  const item = { name, price, qty, vat };
  if (cost > 0) item.cost = cost;
  aoManual.push(item);
  renderNewOrder();
};
window.aoRemoveManual = idx => { aoManual.splice(idx, 1); renderNewOrder(); };

window.submitAdminOrder = async function () {
  const uid = $("ao-user")?.value;
  if (!uid) { showToast("Müşteri seçin"); return; }
  const user = adminUsers.find(u => u.uid === uid);
  if (!user) return;
  if (Object.keys(aoCart).length === 0 && aoManual.length === 0) { showToast("Sipariş boş"); return; }

  const items = Object.keys(aoCart).map(id => {
    const p = products.find(x => x.id === id);
    const pr = aoPrice(p);
    const it = { id: p.id, code: p.code, name: p.name, qty: aoCart[id], price: pr, vat: vatOf(p), vatAmount: pr * aoCart[id] * vatOf(p) };
    if (aoPrices[id] !== undefined) { it.listPrice = p.price; it.priceEdited = true; }
    return it;
  }).concat(aoManual.map(m => {
    const it = { manual: true, code: "MNL", name: m.name, qty: m.qty, price: m.price, vat: m.vat, vatAmount: m.price * m.qty * m.vat };
    if (m.cost) it.cost = m.cost;
    return it;
  }));

  const t = itemTotals(items);
  const dVal = $("ao-date")?.value;
  const d = dVal ? new Date(dVal) : new Date();

  await addDoc(collection(db, "orders"), {
    num: "SP" + Date.now().toString().slice(-6),
    uid, cafe: user.cafe, contact: user.name, phone: user.phone || "",
    note: $("ao-note")?.value || "",
    items, total: t.total, totalVat: t.totalVat, totalWithVat: t.totalWithVat,
    status: "bekliyor",
    createdAt: d.toISOString(),
    date: d.toLocaleDateString("tr-TR"),
    addedByAdmin: true
  });
  aoCart = {}; aoPrices = {}; aoManual = [];
  showToast(`${user.cafe} için sipariş oluşturuldu`);
  renderNewOrder();
};

// =====================================================
// PROFORMA
// =====================================================
window.generateProforma = function (orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  const totalVat = o.totalVat ?? o.items.reduce((s, i) => s + i.price * i.qty * vatOf(i), 0);
  const totalWithVat = o.totalWithVat ?? (o.total + totalVat);
  const f = n => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const rows = o.items.map(i => {
    const lineNet = i.price * i.qty;
    const lineVat = lineNet * vatOf(i);
    return `<tr>
      <td>${esc(i.code || "—")}</td>
      <td>${esc(i.name)}</td>
      <td class="r">${i.qty}</td>
      <td class="r">₺${f(i.price)}</td>
      <td class="r">%${Math.round(vatOf(i) * 100)}</td>
      <td class="r">₺${f(lineVat)}</td>
      <td class="r b">₺${f(lineNet + lineVat)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<title>Proforma ${esc(o.num)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,"Segoe UI",Arial,sans-serif; color:#141414; background:#fff; padding:48px; font-size:13px; }
  .top { display:flex; justify-content:space-between; align-items:baseline; padding-bottom:14px; border-bottom:2px solid #141414; }
  .mark { font-size:18px; letter-spacing:6px; font-weight:600; }
  .doc { text-align:right; }
  .doc h1 { font-size:13px; letter-spacing:3px; font-weight:600; }
  .doc .sub { font-size:11px; color:#77766F; margin-top:2px; }
  .parties { display:flex; gap:40px; margin:26px 0; }
  .party { flex:1; }
  .plbl { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#A3A29C; margin-bottom:6px; }
  .pname { font-size:15px; font-weight:600; }
  .pdet { font-size:12px; color:#77766F; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  th { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:#A3A29C; text-align:left; padding:8px 8px; border-bottom:1px solid #141414; font-weight:600; }
  td { padding:9px 8px; border-bottom:0.5px solid #E3E1DA; font-variant-numeric:tabular-nums; }
  .r { text-align:right; } th.r { text-align:right; }
  .b { font-weight:600; }
  .totals { margin-left:auto; width:300px; margin-top:16px; }
  .trow { display:flex; justify-content:space-between; padding:6px 0; border-bottom:0.5px solid #E3E1DA; font-variant-numeric:tabular-nums; }
  .trow.grand { border-bottom:0; border-top:2px solid #141414; margin-top:4px; padding-top:10px; font-size:16px; font-weight:600; }
  .note { margin-top:28px; font-size:12px; color:#77766F; border:0.5px solid #E3E1DA; padding:10px 14px; }
  .foot { margin-top:44px; padding-top:14px; border-top:0.5px solid #E3E1DA; font-size:10px; color:#A3A29C; text-align:center; letter-spacing:0.5px; }
  .print-btn { position:fixed; top:16px; right:16px; background:#141414; color:#fff; border:0; padding:10px 20px; font-size:11px; letter-spacing:2px; cursor:pointer; }
  @media print { .print-btn { display:none; } body { padding:24px; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">YAZDIR</button>
<div class="top">
  <span class="mark">FLAT</span>
  <div class="doc"><h1>PROFORMA</h1><div class="sub">${esc(o.num)} · ${esc(o.date || "")}</div></div>
</div>
<div class="parties">
  <div class="party"><div class="plbl">Satıcı</div><div class="pname">Flat Coffee &amp; Cake</div><div class="pdet">Merkez Üretim</div></div>
  <div class="party"><div class="plbl">Alıcı</div><div class="pname">${esc(o.cafe)}</div><div class="pdet">${esc(o.contact)}${o.phone ? " · " + esc(o.phone) : ""}</div></div>
</div>
<table>
  <thead><tr><th>No</th><th>Ürün</th><th class="r">Adet</th><th class="r">Birim</th><th class="r">KDV</th><th class="r">KDV Tutarı</th><th class="r">Toplam</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="trow"><span>Ara toplam</span><span>₺${f(o.total)}</span></div>
  <div class="trow"><span>Toplam KDV</span><span>₺${f(totalVat)}</span></div>
  <div class="trow grand"><span>Genel toplam</span><span>₺${f(totalWithVat)}</span></div>
</div>
${o.note ? `<div class="note">Not: ${esc(o.note)}</div>` : ""}
<div class="foot">Bu belge proforma niteliğinde olup resmi fatura değildir · Flat Coffee &amp; Cake · ${new Date().toLocaleDateString("tr-TR")}</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { showToast("Açılır pencere engellendi — tarayıcı izni verin"); return; }
  w.document.write(html);
  w.document.close();
};

// =====================================================
// ÜRÜNLER
// =====================================================
let prodFilter = "Tümü";
let prodOpenId = null; // stok girişi açık ürün

function stockBadge(p) {
  if (p.unstocked) return `<span class="eyebrow">Stoksuz satış</span>`;
  const s = p.stock ?? 0;
  const min = p.minStock ?? 5;
  if (s <= 0) return `<span class="stock-note out">Tükendi</span>`;
  if (s <= min) return `<span class="stock-note low">Kritik · ${s}</span>`;
  return `<span class="eyebrow num">Stok ${s}</span>`;
}

function renderProducts() {
  const search = $("pr-search")?.value || "";
  const q = search.toLocaleLowerCase("tr");
  let list = prodFilter === "Tümü" ? products : products.filter(p => p.cat === prodFilter);
  if (q) list = list.filter(p => (p.name || "").toLocaleLowerCase("tr").includes(q) || String(p.code || "").includes(q));
  const kritik = products.filter(p => !p.unstocked && (p.stock ?? 0) <= (p.minStock ?? 5));
  const cats = ["Tümü", ...siteCategories.map(c => c.name)];

  $("pane-products").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat-num">${products.length}</div><div class="stat-lbl">Ürün</div></div>
      <div class="stat ${kritik.length ? "alert" : ""}"><div class="stat-num">${kritik.length}</div><div class="stat-lbl">Kritik stok</div></div>
      <div class="stat"><div class="stat-num">${siteCategories.length}</div><div class="stat-lbl">Kategori</div></div>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-title">Yeni ürün</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <span style="flex:1;min-width:110px"><label class="lbl">Kod * <button class="link" style="font-size:10px" onclick="suggestCode()">sıradaki</button></label><input class="field" id="np-code"></span>
        <span style="flex:2;min-width:170px"><label class="lbl">Ürün adı *</label><input class="field" id="np-name"></span>
        <span style="flex:1;min-width:110px"><label class="lbl">Fiyat ${TL} (KDV hariç) *</label><input class="field" type="number" step="0.01" min="0" id="np-price"></span>
        <span style="flex:1;min-width:130px"><label class="lbl">Kategori *</label>
          <select class="sel" id="np-cat" style="width:100%;margin-top:6px">
            <option value="">Seçin…</option>
            ${siteCategories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}
          </select></span>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <span style="flex:1;min-width:110px"><label class="lbl">KDV</label>
          <select class="sel" id="np-vat" style="width:100%;margin-top:6px">
            <option value="0.20">%20</option><option value="0.10">%10</option><option value="0.01">%1</option><option value="0">Yok</option>
          </select></span>
        <span style="flex:1;min-width:110px"><label class="lbl">Başlangıç stok</label><input class="field" type="number" min="0" id="np-stock" placeholder="0"></span>
        <span style="flex:1;min-width:110px"><label class="lbl">Kritik eşik</label><input class="field" type="number" min="0" id="np-min" placeholder="5"></span>
        <span style="flex:1;min-width:90px"><label class="lbl">Emoji</label><input class="field" id="np-emoji" placeholder="☕"></span>
        <span style="flex:2;min-width:180px"><label class="lbl">Fotoğraf URL</label><input class="field" id="np-img" placeholder="https://…"></span>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="np-unstocked" style="width:15px;height:15px;accent-color:var(--ink)">
        Stoksuz satış <span class="eyebrow">— sipariş tamamlanırken alış fiyatı sorulur</span>
      </label>
      <button class="btn-ghost" style="margin-top:14px" onclick="addProduct()">Ürünü ekle</button>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-title">Kategoriler</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">
        ${siteCategories.map(c => `<span style="border:0.5px solid var(--hair);padding:4px 10px;font-size:12px;display:inline-flex;gap:8px;align-items:center">${esc(c.name)}<button class="x-btn" style="font-size:13px" onclick="deleteCategory('${c.id}', '${esc(c.name)}')" aria-label="Kategoriyi sil">×</button></span>`).join("")}
        <input class="field" id="new-cat" placeholder="Yeni kategori" style="width:140px;padding:4px 0">
        <button class="btn-ghost" onclick="addCategory()">Ekle</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Katalog</div>
      <input class="field" id="pr-search" placeholder="Ürün ara" value="${esc(search)}" oninput="renderProductsKeep()">
      <div class="cats" style="padding:12px 0 0">
        ${cats.map(c => `<button class="cat ${c === prodFilter ? "active" : ""}" onclick="setProdFilter('${esc(c)}')">${esc(c)}</button>`).join("")}
      </div>
      <div style="margin-top:6px">
        ${list.map(p => prodRow(p)).join("") || `<div class="empty">Ürün yok</div>`}
      </div>
    </div>`;
}
window.renderProductsKeep = function () {
  const el = $("pr-search");
  const pos = el ? el.selectionStart : null;
  renderProducts();
  if (pos !== null) { const n = $("pr-search"); n.focus(); n.setSelectionRange(pos, pos); }
};
window.setProdFilter = c => { prodFilter = c; renderProducts(); };

function prodRow(p) {
  const open = prodOpenId === p.id;
  return `<div class="edit-row" style="align-items:flex-start;padding:12px 0">
    <div style="flex:2;min-width:160px">
      <div class="eyebrow">No ${esc(p.code || "—")} · ${esc(p.cat || "—")}</div>
      <div>${p.emoji || ""} ${esc(p.name)}</div>
      <div style="margin-top:3px">${stockBadge(p)}${p.img ? ` <span class="eyebrow">foto ✓</span>` : ""}</div>
    </div>
    <label class="eyebrow">Fiyat ${TL}<input type="number" step="0.01" min="0" value="${p.price}" id="pp-${p.id}"></label>
    <label class="eyebrow">Stok <input type="number" value="${p.stock ?? 0}" id="ps-${p.id}" ${p.unstocked ? "disabled" : ""}></label>
    <label class="eyebrow">Eşik <input type="number" min="0" value="${p.minStock ?? 5}" id="pm-${p.id}" style="width:52px"></label>
    <label class="eyebrow">KDV <select class="sel" id="pv-${p.id}">
      <option value="0.20" ${vatOf(p) === 0.20 ? "selected" : ""}>%20</option>
      <option value="0.10" ${vatOf(p) === 0.10 ? "selected" : ""}>%10</option>
      <option value="0.01" ${vatOf(p) === 0.01 ? "selected" : ""}>%1</option>
      <option value="0" ${vatOf(p) === 0 ? "selected" : ""}>Yok</option>
    </select></label>
    <span style="display:flex;gap:8px;align-items:center;padding-top:12px">
      <button class="btn-ghost" onclick="saveProduct('${p.id}')">Kaydet</button>
      ${p.unstocked ? "" : `<button class="btn-ghost" onclick="toggleStockEntry('${p.id}')">Stok girişi</button>`}
      <button class="x-btn" onclick="deleteProduct('${p.id}', '${esc(p.name)}')" aria-label="Ürünü sil">×</button>
    </span>
    ${open ? `<div style="flex-basis:100%;border:0.5px solid var(--hair);padding:12px 14px;margin-top:8px">
      <div class="eyebrow" style="margin-bottom:4px">Stok girişi — ${esc(p.name)}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <span><label class="lbl">Miktar</label><input class="field" type="number" min="1" id="se-qty" style="width:100px"></span>
        <span><label class="lbl">Birim alış ${TL}</label><input class="field" type="number" step="0.01" min="0" id="se-cost" style="width:120px"></span>
        <button class="btn-ghost" onclick="addStockEntry('${p.id}')">Kaydet</button>
      </div>
      <div class="eyebrow" style="margin-top:8px">Giriş, stok adedini artırır; maliyet FIFO ile sipariş tamamlanırken düşülür.</div>
    </div>` : ""}
  </div>`;
}

window.toggleStockEntry = id => { prodOpenId = prodOpenId === id ? null : id; renderProducts(); };

window.suggestCode = function () {
  const nums = products.map(p => parseInt(p.code, 10)).filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  $("np-code").value = String(next).padStart(3, "0");
};

window.addProduct = async function () {
  const code = $("np-code").value.trim();
  const name = $("np-name").value.trim();
  const price = num($("np-price").value);
  const cat = $("np-cat").value;
  if (!code || !name || price <= 0 || !cat) { showToast("Kod, ad, fiyat ve kategori zorunlu"); return; }
  if (products.some(p => p.code === code)) { showToast("Bu kod zaten kullanımda"); return; }
  const data = {
    code, name, price, cat,
    vat: Number($("np-vat").value),
    stock: parseInt($("np-stock").value, 10) || 0,
    minStock: parseInt($("np-min").value, 10) || 5,
    emoji: $("np-emoji").value.trim(),
    unstocked: $("np-unstocked").checked
  };
  const img = $("np-img").value.trim();
  if (img) data.img = img;
  await addDoc(collection(db, "products"), data);
  showToast("Ürün eklendi");
};

window.saveProduct = async function (id) {
  const price = num($("pp-" + id).value);
  if (price <= 0) { showToast("Geçerli fiyat girin"); return; }
  const upd = {
    price,
    minStock: parseInt($("pm-" + id).value, 10) || 5,
    vat: Number($("pv-" + id).value)
  };
  const stockEl = $("ps-" + id);
  if (stockEl && !stockEl.disabled) upd.stock = parseInt(stockEl.value, 10) || 0;
  await updateDoc(doc(db, "products", id), upd);
  showToast("Kaydedildi");
};

window.deleteProduct = async function (id, name) {
  if (!confirm(`"${name}" silinsin mi? Geçmiş siparişlerdeki kayıtları etkilenmez.`)) return;
  await deleteDoc(doc(db, "products", id));
  showToast("Silindi");
};

window.addStockEntry = async function (productId) {
  const qty = parseInt($("se-qty").value, 10);
  const cost = num($("se-cost").value);
  if (!qty || qty < 1 || cost <= 0) { showToast("Miktar ve alış fiyatı gerekli"); return; }
  await addDoc(collection(db, "stockEntries"), {
    productId, qty, remaining: qty, cost,
    date: new Date().toISOString(),
    dateStr: new Date().toLocaleDateString("tr-TR")
  });
  const p = products.find(x => x.id === productId);
  await updateDoc(doc(db, "products", productId), { stock: (p?.stock || 0) + qty });
  prodOpenId = null;
  showToast("Stok girişi kaydedildi");
};

window.addCategory = async function () {
  const name = $("new-cat").value.trim();
  if (!name) return;
  if (siteCategories.some(c => c.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) { showToast("Bu kategori zaten var"); return; }
  await addDoc(collection(db, "siteCategories"), { name, order: siteCategories.length + 1 });
  showToast("Kategori eklendi");
};

window.deleteCategory = async function (id, name) {
  const used = products.filter(p => p.cat === name).length;
  if (used > 0) { showToast(`Silinemez — ${used} ürün bu kategoride`); return; }
  if (!confirm(`"${name}" kategorisi silinsin mi?`)) return;
  await deleteDoc(doc(db, "siteCategories", id));
  showToast("Kategori silindi");
};

// =====================================================
// ÜYELER
// =====================================================
async function renderUsers() {
  await loadUsersQuiet();
  const bekleyen = adminUsers.filter(u => u.approved === false);
  $("pane-users").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat-num">${adminUsers.length}</div><div class="stat-lbl">Üye</div></div>
      <div class="stat ${bekleyen.length ? "alert" : ""}"><div class="stat-num">${bekleyen.length}</div><div class="stat-lbl">Onay bekleyen</div></div>
    </div>
    ${adminUsers.map(u => userRow(u)).join("") || `<div class="empty">Üye yok</div>`}
    <div style="height:32px"></div>`;
}
async function loadUsersQuiet() {
  const snap = await getDocs(collection(db, "users"));
  adminUsers = snap.docs.map(d => d.data()).sort((a, b) => (a.cafe || "").localeCompare(b.cafe || "", "tr"));
}

function userRow(u) {
  const open = openUserUid === u.uid;
  const orders = open ? allOrders.filter(o => o.uid === u.uid) : [];
  return `<div class="o-card">
    <div class="o-head">
      <span>
        <span style="font-weight:500">${esc(u.cafe || "—")}</span>
        <span class="o-meta" style="display:inline;margin-left:8px">${esc(u.name || "")}</span>
        ${u.approved === false ? `<span class="status bekliyor" style="margin-left:8px">Onay bekliyor</span>` : ""}
        ${u.adminApproved ? `<span class="eyebrow" style="margin-left:8px">Panel yetkili</span>` : ""}
      </span>
      <span class="eyebrow num">${u.orderCount || 0} sipariş · ${TL}${fmt(u.totalSpent || 0)}</span>
    </div>
    <div class="o-meta">${esc(u.phone || "—")} · ${esc(u.email || "—")}</div>
    <div class="o-actions">
      ${u.approved === false ? `<button class="btn-ghost" style="border-color:var(--ok);color:var(--ok)" onclick="approveUser('${u.uid}')">Onayla</button>` : ""}
      <button class="btn-ghost" onclick="toggleAdminAccess('${u.uid}', ${u.adminApproved === true})">${u.adminApproved ? "Panel yetkisini al" : "Panel yetkisi ver"}</button>
      <button class="btn-ghost" onclick="adminSendReset('${esc(u.email || "")}')">Şifre sıfırla</button>
      <button class="btn-ghost" onclick="toggleUserDetail('${u.uid}')">${open ? "Geçmişi kapat" : "Sipariş geçmişi"}</button>
    </div>
    ${open ? `<div style="margin-top:10px;border-top:0.5px solid var(--hair);padding-top:8px">
      ${orders.length === 0 ? `<div class="empty" style="padding:16px 0">Sipariş yok</div>` :
        orders.map(o => `<div class="sum-row">
          <span><span class="num">${esc(o.num)}</span> <span class="status ${esc(o.status)}" style="margin-left:8px">${STATUS_LABEL[o.status] || esc(o.status)}</span></span>
          <span class="eyebrow">${esc(o.date || "")}</span>
          <span class="num" style="min-width:80px;text-align:right">${TL}${fmt(o.total)}</span>
        </div>`).join("")}
    </div>` : ""}
  </div>`;
}

window.toggleUserDetail = uid => { openUserUid = openUserUid === uid ? null : uid; renderUsers(); };

window.approveUser = async function (uid) {
  await updateDoc(doc(db, "users", uid), { approved: true });
  showToast("Üye onaylandı");
  renderUsers();
};

window.toggleAdminAccess = async function (uid, has) {
  if (!has && !confirm("Bu üyeye panel yetkisi verilsin mi? Siparişleri, ürünleri ve raporları yönetebilecek.")) return;
  await updateDoc(doc(db, "users", uid), { adminApproved: !has });
  showToast(has ? "Panel yetkisi alındı" : "Panel yetkisi verildi");
  renderUsers();
};

window.adminSendReset = async function (email) {
  if (!email) { showToast("E-posta kayıtlı değil"); return; }
  if (!confirm(`${email} adresine şifre sıfırlama maili gönderilsin mi?`)) return;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Sıfırlama maili gönderildi");
  } catch (e) { showToast("Gönderilemedi"); }
};

// =====================================================
// RAPORLAR
// =====================================================
let reportPeriod = "all";

function inPeriod(o) {
  if (reportPeriod === "all") return true;
  const d = new Date(o.createdAt || 0);
  const now = new Date();
  if (reportPeriod === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (reportPeriod === "prev") {
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === pm.getFullYear() && d.getMonth() === pm.getMonth();
  }
  return true;
}

function renderReports() {
  const done = allOrders.filter(o => (o.status === "tamamlandi" || o.status === "teslim-bekliyor") && inPeriod(o));
  let revenue = 0, cost = 0, unknown = 0;
  const rows = done.map(o => {
    const oCost = (o.items || []).reduce((s, i) => {
      if (i.costTotal !== undefined) return s + i.costTotal;
      if (i.cost !== undefined) return s + i.cost * i.qty;
      unknown++;
      return s;
    }, 0);
    revenue += o.total; cost += oCost;
    const profit = o.total - oCost;
    return { o, oCost, profit, margin: o.total > 0 ? (profit / o.total * 100) : 0 };
  });
  const profit = revenue - cost;

  $("pane-reports").innerHTML = `
    <div class="toolbar">
      <span class="eyebrow">Dönem</span>
      <select class="sel" onchange="setReportPeriod(this.value)">
        <option value="all" ${reportPeriod === "all" ? "selected" : ""}>Tümü</option>
        <option value="month" ${reportPeriod === "month" ? "selected" : ""}>Bu ay</option>
        <option value="prev" ${reportPeriod === "prev" ? "selected" : ""}>Geçen ay</option>
      </select>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${TL}${fmt(revenue)}</div><div class="stat-lbl">Ciro (KDV hariç)</div></div>
      <div class="stat"><div class="stat-num">${TL}${fmt(cost)}</div><div class="stat-lbl">Maliyet</div></div>
      <div class="stat"><div class="stat-num">${TL}${fmt(profit)}</div><div class="stat-lbl">Kâr</div></div>
      <div class="stat"><div class="stat-num">${revenue > 0 ? (profit / revenue * 100).toFixed(1) : "0"}%</div><div class="stat-lbl">Marj</div></div>
    </div>
    ${unknown > 0 ? `<div class="note-box" style="margin:14px 20px 0">Bazı kalemlerde maliyet kaydı yok (eski siparişler veya alış fiyatı girilmemiş ürünler) — bu kalemler maliyete 0 olarak yansıdı, kâr olduğundan yüksek görünebilir.</div>` : ""}
    <div class="section">
      <div class="section-title">Sipariş bazında</div>
      ${rows.length === 0 ? `<div class="empty">Bu dönemde tamamlanan sipariş yok</div>` :
        rows.map(r => `<div class="sum-row">
          <span style="flex:1;min-width:0"><span class="num">${esc(r.o.num)}</span> <span class="o-meta" style="display:inline;margin-left:6px">${esc(r.o.cafe)}</span></span>
          <span class="eyebrow">${esc(r.o.date || "")}</span>
          <span class="num" style="min-width:88px;text-align:right">${TL}${fmt(r.o.total)}</span>
          <span class="num" style="min-width:88px;text-align:right;color:var(--soft)">−${TL}${fmt(r.oCost)}</span>
          <span class="num" style="min-width:96px;text-align:right;font-weight:500;color:${r.profit >= 0 ? "var(--ok)" : "var(--danger)"}">${TL}${fmt(r.profit)} <span class="eyebrow">%${r.margin.toFixed(0)}</span></span>
        </div>`).join("")}
    </div>`;
}
window.setReportPeriod = v => { reportPeriod = v; renderReports(); };
