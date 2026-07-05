// FLAT ORDER — müşteri uygulaması
import { db, auth, googleProvider, ADMIN_EMAILS } from "./config.js?v=1";
import {
  collection, doc, addDoc, updateDoc, setDoc, getDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult,
  updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ---------- durum ----------
let currentUser = null;
let userProfile = null;
let products = [];
let myOrders = [];
let cart = {};            // id -> adet
let activeCat = "Tümü";
let currentView = "catalog";
let unsubProducts = null, unsubOrders = null;
let dlvState = {};        // teslimat onayı: orderId_idx -> {checked, qty}

// ---------- yardımcılar ----------
const $ = id => document.getElementById(id);
const TL = `<span class="tl">₺</span>`;
const fmt = n => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
const fmtInt = n => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
const vatOf = p => p?.vat ?? 0.20;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- auth ----------
window.switchAuthTab = function (tab) {
  $("tab-login").classList.toggle("active", tab === "login");
  $("tab-register").classList.toggle("active", tab === "register");
  $("login-form").style.display = tab === "login" ? "block" : "none";
  $("register-form").style.display = tab === "register" ? "block" : "none";
  hideAuthMsgs();
};

function showAuthErr(msg) { $("auth-err").textContent = msg; $("auth-err").style.display = "block"; $("auth-info").style.display = "none"; }
function showAuthInfo(msg) { $("auth-info").textContent = msg; $("auth-info").style.display = "block"; $("auth-err").style.display = "none"; }
function hideAuthMsgs() { $("auth-err").style.display = "none"; $("auth-info").style.display = "none"; }

window.doLogin = async function () {
  const email = $("login-email").value.trim();
  const pw = $("login-pw").value;
  if (!email || !pw) { showAuthErr("E-posta ve şifre gerekli."); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    const m = { "auth/user-not-found": "Bu e-posta ile kayıt bulunamadı.", "auth/wrong-password": "Şifre yanlış.", "auth/invalid-credential": "E-posta veya şifre hatalı." };
    showAuthErr(m[e.code] || "Giriş başarısız.");
  }
};

window.doRegister = async function () {
  const cafe = $("reg-cafe").value.trim();
  const name = $("reg-name").value.trim();
  const phone = $("reg-phone").value.trim();
  const email = $("reg-email").value.trim();
  const pw = $("reg-pw").value;
  if (!cafe || !name || !email || !pw) { showAuthErr("Zorunlu alanları doldurun."); return; }
  if (pw.length < 6) { showAuthErr("Şifre en az 6 karakter olmalı."); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: cafe });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid, cafe, name, phone, email,
      createdAt: new Date().toISOString(),
      orderCount: 0, totalSpent: 0, approved: false
    });
  } catch (e) {
    const m = { "auth/email-already-in-use": "Bu e-posta zaten kayıtlı.", "auth/invalid-email": "Geçersiz e-posta." };
    showAuthErr(m[e.code] || "Kayıt başarısız.");
  }
};

async function ensureUserDoc(user) {
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);
  if (!snap.exists()) {
    await setDoc(uref, {
      uid: user.uid, cafe: user.displayName || "", name: user.displayName || "",
      phone: "", email: user.email,
      createdAt: new Date().toISOString(),
      orderCount: 0, totalSpent: 0, approved: false
    });
  }
}

window.doGoogleLogin = async function () {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    await ensureUserDoc(res.user);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/popup-closed-by-user" && /Mobi|Android/i.test(navigator.userAgent) || e.code === "auth/operation-not-supported-in-this-environment") {
      try { await signInWithRedirect(auth, googleProvider); } catch (_) { showAuthErr("Google girişi başarısız."); }
    } else if (e.code !== "auth/popup-closed-by-user") {
      showAuthErr("Google girişi başarısız.");
    }
  }
};

// Yönlendirmeli girişten dönüşte üyelik kaydını garanti et
getRedirectResult(auth).then(res => { if (res?.user) return ensureUserDoc(res.user); }).catch(() => {});

window.doForgotPassword = async function () {
  const email = $("login-email").value.trim();
  if (!email) { showAuthErr('Önce e-posta adresinizi yazın, sonra "Şifremi unuttum"a tıklayın.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthInfo("Sıfırlama bağlantısı gönderildi. Gelen kutunuzu ve spam klasörünü kontrol edin.");
  } catch (e) {
    const m = { "auth/user-not-found": "Bu e-posta ile kayıt bulunamadı.", "auth/invalid-email": "Geçersiz e-posta." };
    showAuthErr(m[e.code] || "Gönderilemedi.");
  }
};

window.doLogout = async function () {
  await signOut(auth);
  cart = {}; dlvState = {};
};

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) { swapScreen("auth-screen"); stopListeners(); return; }

  // Profil yazımı gecikebilir (kayıt anı) — birkaç kez dene
  userProfile = null;
  for (let i = 0; i < 4; i++) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) { userProfile = snap.data(); break; }
    await new Promise(r => setTimeout(r, 700));
  }

  const isAdmin = ADMIN_EMAILS.includes(user.email) || userProfile?.adminApproved === true;
  // Varsayılan ret: içeri sadece admin, onaylı üye veya eski kayıt (onay alanı hiç olmayan) girer
  const legacy = userProfile && userProfile.approved === undefined;
  const allowed = isAdmin || userProfile?.approved === true || legacy;
  if (!allowed) { swapScreen("pending-screen"); stopListeners(); return; }

  swapScreen("app");
  $("header-meta").innerHTML = isAdmin
    ? `<a href="admin.html" style="color:var(--soft);text-decoration:none">Panel →</a><span style="margin-left:14px">${esc(userProfile?.cafe || user.email || "")}</span>`
    : esc(userProfile?.cafe || user.email || "");
  startListeners();
  showView("catalog");
});

function swapScreen(id) {
  ["app", "auth-screen", "pending-screen"].forEach(s => $(s).style.display = s === id ? "flex" : "none");
}

// ---------- veri ----------
function startListeners() {
  stopListeners();
  unsubProducts = onSnapshot(collection(db, "products"), snap => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    products.sort((a, b) => (a.code || "").localeCompare(b.code || "", "tr", { numeric: true }));
    if (currentView === "catalog") renderCatalog();
    if (currentView === "cart") renderCart();
    renderBar();
  });
  unsubOrders = onSnapshot(query(collection(db, "orders"), where("uid", "==", currentUser.uid)), snap => {
    myOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    myOrders.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (currentView === "orders") renderOrders();
  });
}
function stopListeners() {
  if (unsubProducts) { unsubProducts(); unsubProducts = null; }
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
}

// ---------- görünüm ----------
window.showView = function (v) {
  currentView = v;
  ["catalog", "cart", "orders"].forEach(x => {
    $("view-" + x).classList.toggle("active", x === v);
    $("nav-" + x).classList.toggle("active", x === v);
  });
  if (v === "catalog") renderCatalog();
  if (v === "cart") renderCart();
  if (v === "orders") renderOrders();
  window.scrollTo(0, 0);
};

function renderBar() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = Object.keys(cart).reduce((s, id) => { const p = products.find(x => x.id == id); return s + (p ? p.price * cart[id] : 0); }, 0);
  $("bar-cta").innerHTML = count === 0
    ? `<span style="color:#8f8e89;font-size:11px;letter-spacing:.12em">SEPET BOŞ</span>`
    : `<span style="font-size:11px;letter-spacing:.12em;color:#8f8e89">${count} KALEM</span><span>${TL}${fmtInt(total)} —&nbsp;SEPETE GİT</span>`;
}

// ---------- katalog ----------
window.setCat = function (c) { activeCat = c; renderCatalog(); };

function renderCatalog() {
  const cats = ["Tümü", ...new Set(products.map(p => p.cat).filter(Boolean))];
  $("cats").innerHTML = cats.map(c =>
    `<button class="cat ${c === activeCat ? "active" : ""}" onclick="setCat('${esc(c)}')">${esc(c)}</button>`
  ).join("");

  const q = ($("search").value || "").toLocaleLowerCase("tr");
  let list = activeCat === "Tümü" ? products : products.filter(p => p.cat === activeCat);
  if (q) list = list.filter(p => (p.name || "").toLocaleLowerCase("tr").includes(q) || String(p.code || "").includes(q));

  if (list.length === 0) { $("catalog-rows").innerHTML = `<div class="empty">Ürün bulunamadı</div>`; return; }

  $("catalog-rows").innerHTML = list.map(p => {
    const qty = cart[p.id] || 0;
    return `<div class="row">
      ${p.img ? `<img class="thumb" src="${esc(p.img)}" alt="">` : `<div class="thumb">${p.emoji || ""}</div>`}
      <div class="row-info">
        <div class="eyebrow">No ${esc(p.code || "—")} — ${esc(p.cat || "")}</div>
        <div class="row-name">${esc(p.name)}</div>
      </div>
      <div class="row-side">
        <div class="price">${TL}${fmt(p.price)}</div>
        ${qty === 0
          ? `<button class="btn-line" onclick="addToCart('${p.id}')">Ekle</button>`
          : `<span class="qty">
              <button onclick="decCart('${p.id}')" aria-label="Azalt">−</button>
              <input type="number" min="0" value="${qty}" onchange="setQty('${p.id}', this.value)" aria-label="Adet">
              <button onclick="addToCart('${p.id}')" aria-label="Artır">+</button>
            </span>`}
      </div>
    </div>`;
  }).join("");
}

window.addToCart = function (id) { cart[id] = (cart[id] || 0) + 1; refreshCartViews(); };
window.decCart = function (id) { cart[id] = (cart[id] || 1) - 1; if (cart[id] <= 0) delete cart[id]; refreshCartViews(); };
window.setQty = function (id, val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) delete cart[id]; else cart[id] = n;
  refreshCartViews();
};
function refreshCartViews() {
  if (currentView === "catalog") renderCatalog();
  if (currentView === "cart") renderCart();
  renderBar();
}

// ---------- sepet ----------
function renderCart() {
  const keys = Object.keys(cart);
  if (keys.length === 0) { $("cart-content").innerHTML = `<div class="empty">Sepetiniz boş</div>`; return; }

  let net = 0, vat = 0;
  const rows = keys.map(id => {
    const p = products.find(x => x.id == id); if (!p) return "";
    const lineNet = p.price * cart[id];
    const lineVat = lineNet * vatOf(p);
    net += lineNet; vat += lineVat;
    return `<div class="row">
      ${p.img ? `<img class="thumb" src="${esc(p.img)}" alt="">` : `<div class="thumb">${p.emoji || ""}</div>`}
      <div class="row-info">
        <div class="eyebrow">No ${esc(p.code || "—")}</div>
        <div class="row-name">${esc(p.name)}</div>
        <div class="row-sub num">${TL}${fmt(p.price)} × ${cart[id]} · KDV %${Math.round(vatOf(p) * 100)}</div>
      </div>
      <div class="row-side">
        <div class="price">${TL}${fmt(lineNet)}</div>
        <span class="qty">
          <button onclick="decCart('${p.id}')" aria-label="Azalt">−</button>
          <input type="number" min="0" value="${cart[id]}" onchange="setQty('${p.id}', this.value)" aria-label="Adet">
          <button onclick="addToCart('${p.id}')" aria-label="Artır">+</button>
        </span>
      </div>
    </div>`;
  }).join("");

  $("cart-content").innerHTML = `
    <div class="rows">${rows}</div>
    <div class="section">
      <div class="section-title">Özet</div>
      <div class="line"><span class="muted">Toplam (KDV hariç)</span><span class="num">${TL}${fmt(net)}</span></div>
      <div class="line"><span class="muted">Toplam KDV</span><span class="num">${TL}${fmt(vat)}</span></div>
      <div class="total-line"><span>Genel toplam</span><span class="num">${TL}${fmt(net + vat)}</span></div>
    </div>
    <div class="section" style="padding-top:0">
      <div class="section-title">Sipariş bilgileri</div>
      <label class="lbl" for="f-cafe">Kafe / şube</label>
      <input class="field" id="f-cafe" value="${esc(userProfile?.cafe || "")}">
      <label class="lbl" for="f-name">Yetkili</label>
      <input class="field" id="f-name" value="${esc(userProfile?.name || "")}">
      <label class="lbl" for="f-phone">Telefon</label>
      <input class="field" type="tel" id="f-phone" value="${esc(userProfile?.phone || "")}">
      <label class="lbl" for="f-note">Not</label>
      <textarea class="field" id="f-note" placeholder="Eklemek istediğiniz bir not var mı?"></textarea>
      <button class="btn-solid" id="submit-btn" onclick="submitOrder()">Siparişi gönder</button>
    </div>`;
}

window.submitOrder = async function () {
  const cafe = $("f-cafe").value.trim();
  const contact = $("f-name").value.trim();
  const phone = $("f-phone").value.trim();
  if (!cafe || !contact || !phone) { showToast("Zorunlu alanları doldurun"); return; }
  const btn = $("submit-btn");
  btn.disabled = true; btn.textContent = "Gönderiliyor";

  const items = Object.keys(cart).map(id => {
    const p = products.find(x => x.id == id);
    return { id: p.id, code: p.code, name: p.name, qty: cart[id], price: p.price, vat: vatOf(p), vatAmount: p.price * cart[id] * vatOf(p) };
  });
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalVat = items.reduce((s, i) => s + i.vatAmount, 0);

  try {
    const ref = await addDoc(collection(db, "orders"), {
      num: "SP" + Date.now().toString().slice(-6),
      uid: currentUser.uid, cafe, contact, phone,
      note: $("f-note").value,
      items, total, totalVat, totalWithVat: total + totalVat,
      status: "bekliyor",
      createdAt: new Date().toISOString(),
      date: new Date().toLocaleString("tr-TR")
    });
    cart = {};
    renderBar();
    showView("orders");
    showToast("Siparişiniz alındı");
  } catch (e) {
    showToast("Gönderilemedi, tekrar deneyin");
    btn.disabled = false; btn.textContent = "Siparişi gönder";
  }
};

// ---------- siparişlerim ----------
const STATUS_LABEL = { bekliyor: "Bekliyor", hazirlaniyor: "Hazırlanıyor", "teslim-bekliyor": "Teslim onayı bekliyor", tamamlandi: "Tamamlandı", iptal: "İptal" };

function renderOrders() {
  if (myOrders.length === 0) { $("orders-content").innerHTML = `<div class="empty">Henüz sipariş yok</div>`; return; }
  $("orders-content").innerHTML = `<div style="height:12px"></div>` + myOrders.map(o => `
    <div class="order">
      <div class="order-head">
        <span><span class="num" style="font-weight:500">${esc(o.num)}</span>
          <span class="status ${esc(o.status)}" style="margin-left:10px">${STATUS_LABEL[o.status] || esc(o.status)}</span></span>
        <span class="eyebrow">${esc(o.date || "")}</span>
      </div>
      <div class="order-items">${(o.items || []).map(i => `${esc(i.name)} ×${i.qty}`).join(" · ")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="num" style="font-size:15px">${TL}${fmt(o.total)}</span>
        <button class="btn-ghost" onclick="reorder('${o.id}')">Tekrarla</button>
      </div>
      ${o.status === "teslim-bekliyor" ? deliveryBlock(o) : ""}
    </div>`).join("");
}

function deliveryBlock(o) {
  if (o.deliveryIssue && !o.issueResolved) {
    return `<div class="deliv" style="border-color:var(--danger)">
      <div class="eyebrow" style="color:var(--danger);margin-bottom:6px">Eksik bildiriminiz iletildi</div>
      <div style="font-size:12px;color:var(--soft)">${(o.missingItems || []).map(m => `${esc(m.name)}: ${m.received}/${m.ordered}`).join(" · ")}</div>
    </div>`;
  }
  return `<div class="deliv">
    <div class="eyebrow" style="margin-bottom:4px">Teslimat onayı</div>
    <div style="font-size:12px;color:var(--soft);margin-bottom:6px">Gelen ürünleri işaretleyin; eksik gelenlerde adedi belirtin.</div>
    ${(o.items || []).map((i, idx) => {
      const st = dlvState[o.id + "_" + idx] || { checked: false, qty: 0 };
      return `<div class="deliv-row">
        <input type="checkbox" ${st.checked ? "checked" : ""} onchange="dlvToggle('${o.id}',${idx},this.checked)">
        <span style="flex:1">${esc(i.name)} <b class="num">×${i.qty}</b></span>
        ${st.checked
          ? `<span class="eyebrow" style="color:var(--ok)">Tamamı geldi</span>`
          : `<span class="qty" style="margin:0">
              <button onclick="dlvStep('${o.id}',${idx},-1,${i.qty})" aria-label="Azalt">−</button>
              <input type="number" readonly value="${st.qty || 0}" aria-label="Gelen adet">
              <button onclick="dlvStep('${o.id}',${idx},1,${i.qty})" aria-label="Artır">+</button>
            </span>`}
      </div>`;
    }).join("")}
    <button class="btn-solid" style="margin-top:14px;padding:11px" onclick="submitDelivery('${o.id}')">Teslimatı onayla</button>
  </div>`;
}

window.dlvToggle = function (oid, idx, checked) {
  dlvState[oid + "_" + idx] = { checked, qty: dlvState[oid + "_" + idx]?.qty || 0 };
  renderOrders();
};
window.dlvStep = function (oid, idx, delta, max) {
  const st = dlvState[oid + "_" + idx] || { checked: false, qty: 0 };
  st.qty = Math.min(max, Math.max(0, (st.qty || 0) + delta));
  st.checked = false;
  dlvState[oid + "_" + idx] = st;
  renderOrders();
};

window.submitDelivery = async function (oid) {
  const o = myOrders.find(x => x.id === oid); if (!o) return;
  const missing = [];
  (o.items || []).forEach((i, idx) => {
    const st = dlvState[oid + "_" + idx] || { checked: false, qty: 0 };
    const received = st.checked ? i.qty : Math.min(st.qty || 0, i.qty);
    if (received < i.qty) missing.push({ code: i.code, name: i.name, ordered: i.qty, received });
  });
  if (missing.length === 0) {
    await updateDoc(doc(db, "orders", oid), { status: "tamamlandi", deliveryConfirmed: true, deliveryConfirmedAt: new Date().toISOString(), deliveryIssue: false });
    showToast("Teslimat onaylandı, teşekkürler");
  } else {
    const ozet = missing.map(m => `• ${m.name}: ${m.received}/${m.ordered} geldi`).join("\n");
    if (!confirm("Eksik bildirilecek ürünler:\n\n" + ozet + "\n\nGönderilsin mi?")) return;
    await updateDoc(doc(db, "orders", oid), { deliveryIssue: true, issueResolved: false, missingItems: missing, deliveryReportedAt: new Date().toISOString() });
    showToast("Eksik bildirimi iletildi");
  }
  (o.items || []).forEach((i, idx) => delete dlvState[oid + "_" + idx]);
};

window.reorder = function (oid) {
  const o = myOrders.find(x => x.id === oid); if (!o) return;
  const missing = [];
  let added = 0;
  (o.items || []).forEach(i => {
    const p = products.find(x => x.id === i.id);
    if (!p) { missing.push(i.name); return; }
    cart[p.id] = (cart[p.id] || 0) + i.qty;
    added++;
  });
  if (added === 0) { showToast("Ürünler artık katalogda yok"); return; }
  if (missing.length) alert("Katalogda olmayan ürünler eklenmedi:\n• " + missing.join("\n• "));
  renderBar();
  showView("cart");
  showToast("Sipariş sepete kopyalandı");
};

// ---------- arama ----------
document.addEventListener("input", e => { if (e.target.id === "search") renderCatalog(); });
