// ============ Doctor Website Engine v40 — إدارة العملاء والاشتراكات ============
// Reads existing data (never duplicates it):
//   websiteDirectory/{slug}               -> slug, clinicId, doctorId, doctorEmail
//   clinics/{clinicId}/websiteSettings/main -> doctorName, specialty, clinicName, phone, isWebsiteEnabled
//   users/{uid}  (where clinicId == X)     -> linked accounts (Firebase UID = identity)
//   clinicMembers/{email} (clinicId == X)  -> invitations not signed in yet
// Writes ONLY to the new collection:
//   customerSubscriptions/{customerId}           -> subscription + notes (platform admin only)
//   customerSubscriptions/{customerId}/audit/{id} -> audit log of each change

import { adminAuth as auth, adminDb as db } from "./firebase-config.js?v=25";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SUPER_ADMIN_EMAILS = ["mostafa.hegab83@gmail.com"];
const ADMIN_ROLES = ["superadmin", "super_admin"];

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const val = (id) => ($(id) ? String($(id).value).trim() : "");
const num = (id) => { const n = parseFloat(val(id)); return isNaN(n) ? null : n; };
const say = (el, t, k) => { el.textContent = t || ""; el.className = "msg" + (k ? " " + k : ""); };

let me = null;
let customers = [];   // docs of customerSubscriptions
let sites = [];       // live website data
let rows = [];        // merged rows for the table
let editingId = null;
let usersCtx = null;

/* ---------- auth (same rule as admin.html: platform admin only) ---------- */
$("liBtn").addEventListener("click", async () => {
  say($("liMsg"), "جارٍ الدخول…");
  try { await signInWithEmailAndPassword(auth, val("liEmail"), $("liPass").value); say($("liMsg"), ""); }
  catch (e) { say($("liMsg"), "بيانات الدخول غير صحيحة.", "err"); }
});
$("outBtn").addEventListener("click", () => signOut(auth));

// صفحة شخصية: تفتح لبريد السوبر أدمن فقط — لا أدوار ولا حسابات أخرى.
async function isAdmin(user) {
  const email = String(user.email || "").toLowerCase();
  return SUPER_ADMIN_EMAILS.includes(email);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { me = null; $("panel").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); return; }
  if (!(await isAdmin(user))) { say($("liMsg"), "هذا الحساب لا يملك صلاحية مدير المنصة.", "err"); await signOut(auth); return; }
  me = user;
  $("whoEmail").textContent = user.email || "";
  $("loginScreen").classList.add("hidden");
  $("panel").classList.remove("hidden");
  loadAll();
});

/* ---------- status + countdown (computed from renewalDate, never typed) ---------- */
function daysLeft(renewal) {
  if (!renewal) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const r = new Date(renewal + "T00:00:00");
  if (isNaN(r)) return null;
  return Math.round((r - t) / 86400000);
}
function statusOf(c) {
  if (!c) return "none";
  if (c.manualStatus === "inactive") return "inactive";
  if (c.manualStatus === "trial" || c.subscriptionType === "trial") {
    const d = daysLeft(c.renewalDate);
    return d != null && d < 0 ? "expired" : "trial";
  }
  const d = daysLeft(c.renewalDate);
  if (d == null) return "inactive";
  if (d < 0) return "expired";
  if (d <= 30) return "soon";
  return "active";
}
const ST = {
  active: "🟢 نشط", soon: "🟡 قريب من التجديد", expired: "🔴 منتهي",
  inactive: "⚪ غير نشط", trial: "🔵 تجريبي", none: "— بدون اشتراك",
};
function countdown(c) {
  const d = daysLeft(c && c.renewalDate);
  if (d == null) return "";
  if (d < 0) return "🔴 انتهى منذ " + (-d) + " يوم";
  if (d === 0) return "🟠 ينتهي اليوم";
  if (d <= 7) return "🟠 " + d + " أيام متبقية";
  if (d <= 30) return "🟡 " + d + " يوم متبقي";
  return "🟢 " + d + " يوم متبقي";
}
function finalPrice(c) {
  const p = Number(c.price) || 0;
  let f = p;
  if (c.discountPercent) f -= p * Number(c.discountPercent) / 100;
  if (c.discountValue) f -= Number(c.discountValue);
  return Math.max(0, Math.round(f * 100) / 100);
}
const TYPE = { website: "Website", clinic: "Clinic Management", both: "Website + Clinic", trial: "تجريبي" };

/* ---------- load ---------- */
async function loadAll() {
  $("loadMsg").textContent = "جارٍ التحميل…";
  customers = []; sites = [];
  try {
    const cs = await getDocs(collection(db, "customerSubscriptions"));
    cs.forEach((d) => customers.push(Object.assign({ id: d.id }, d.data())));
  } catch (e) {
    $("loadMsg").textContent = "⚠️ تعذرت قراءة الاشتراكات — تأكد من نشر قواعد الأمان الجديدة (firestore.rules).";
  }
  try {
    const dir = await getDocs(collection(db, "websiteDirectory"));
    const list = [];
    dir.forEach((d) => { const x = d.data() || {}; list.push({ slug: x.slug || d.id, clinicId: x.clinicId || d.id, doctorEmail: String(x.doctorEmail || "").toLowerCase() }); });
    await Promise.all(list.map(async (s) => {
      try { const w = await getDoc(doc(db, "clinics", s.clinicId, "websiteSettings", "main")); s.settings = w.exists() ? w.data() : {}; }
      catch { s.settings = {}; }
    }));
    sites = list;
  } catch { /* ignore */ }

  // users count per clinic (one query per distinct clinic)
  const clinicIds = [...new Set(customers.map((c) => c.clinicId).concat(sites.map((s) => s.clinicId)).filter(Boolean))];
  const counts = {};
  await Promise.all(clinicIds.map(async (cid) => {
    try { const u = await getDocs(query(collection(db, "users"), where("clinicId", "==", cid))); counts[cid] = u.size; }
    catch { counts[cid] = null; }
  }));

  buildRows(counts);
  if (!$("loadMsg").textContent.startsWith("⚠️")) $("loadMsg").textContent = "";
}

function siteUrl(slug) { return location.href.replace(/customers\.html.*$/, "") + "index.html?slug=" + encodeURIComponent(slug); }

function buildRows(counts) {
  const used = new Set();
  rows = customers.map((c) => {
    const s = sites.find((x) => c.slug && x.slug === c.slug) || null;
    if (s) used.add(s.slug);
    return mkRow(c, s, counts);
  });
  // existing websites with no subscription record yet: shown, not copied
  sites.filter((s) => !used.has(s.slug)).forEach((s) => rows.push(mkRow(null, s, counts)));
  rows.sort((a, b) => (a.no || "zz").localeCompare(b.no || "zz") || a.name.localeCompare(b.name, "ar"));
  fillFilters();
  render();
}
function mkRow(c, s, counts) {
  const st = (s && s.settings) || {};
  const clinicId = (c && c.clinicId) || (s && s.clinicId) || "";
  return {
    c, s,
    no: (c && c.customerNo) || "",
    name: (c && c.doctorName) || st.doctorName || "",
    email: (c && c.email) || (s && s.doctorEmail) || st.email || "",
    phone: (c && c.phone) || st.phone || "",
    clinicName: (c && c.clinicName) || st.clinicName || "",
    specialty: (c && c.specialty) || st.specialty || "",
    clinicId, slug: (c && c.slug) || (s && s.slug) || "",
    users: counts[clinicId],
    status: statusOf(c),
    siteOn: !!(s && st.isWebsiteEnabled !== false),
    archived: !!(c && c.archived),
  };
}

function fillFilters() {
  const keep = (id, values, label) => {
    const cur = val(id);
    $(id).innerHTML = '<option value="">' + label + "</option>" +
      [...new Set(values.filter(Boolean))].sort().map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
    $(id).value = cur;
  };
  keep("fSpec", rows.map((r) => r.specialty), "كل التخصصات");
  keep("fOffer", rows.map((r) => r.c && r.c.offer), "كل العروض");
  const cur = val("fType");
  $("fType").innerHTML = '<option value="">كل الأنواع</option>' + Object.keys(TYPE).map((k) => '<option value="' + k + '">' + TYPE[k] + "</option>").join("");
  $("fType").value = cur;
}

/* ---------- table ---------- */
function filtered() {
  const q = val("cq").toLowerCase();
  const st = val("fSt"), sp = val("fSpec"), ty = val("fType"), of = val("fOffer");
  const arch = $("fArch").checked;
  return rows.filter((r) => {
    if (r.archived && !arch) return false;
    if (st && r.status !== st) return false;
    if (sp && r.specialty !== sp) return false;
    if (ty && !(r.c && r.c.subscriptionType === ty)) return false;
    if (of && !(r.c && r.c.offer === of)) return false;
    if (!q) return true;
    return [r.name, r.email, r.phone, r.clinicName, r.clinicId, r.slug, r.no].join(" ").toLowerCase().includes(q);
  });
}

function render() {
  const all = rows.filter((r) => !r.archived);
  $("kTotal").textContent = all.length;
  $("kActive").textContent = all.filter((r) => r.status === "active" || r.status === "soon").length;
  $("kSoon").textContent = all.filter((r) => r.status === "soon").length;
  $("kExpired").textContent = all.filter((r) => r.status === "expired").length;
  $("kOffers").textContent = all.filter((r) => r.c && (r.c.offer || r.c.freeWebsite || r.c.freePeriod)).length;
  $("kSites").textContent = all.filter((r) => r.siteOn).length;

  const list = filtered();
  if (!list.length) { $("cRows").innerHTML = '<tr><td colspan="15" class="empty">لا يوجد عملاء مطابقون.</td></tr>'; return; }
  $("cRows").innerHTML = list.map((r, i) => {
    const c = r.c || {};
    const offer = [c.offer, c.discountPercent ? c.discountPercent + "%" : "", c.discountValue ? "-" + c.discountValue : ""].filter(Boolean).join(" · ");
    const upd = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString("ar-EG") + (c.updatedBy ? "<br><span class='sub'>" + esc(c.updatedBy) + "</span>" : "") : "—";
    const key = r.c ? "c:" + r.c.id : "s:" + r.slug;
    return "<tr" + (r.archived ? " class='arch'" : "") + ">" +
      "<td>" + esc(r.no || "—") + "</td>" +
      "<td><a href='#' class='slug-link' data-users='" + esc(key) + "'>" + esc(r.name || "—") + "</a>" + (r.slug ? "<br><a class='sub' target='_blank' rel='noopener' href='" + esc(siteUrl(r.slug)) + "'>/" + esc(r.slug) + "</a>" : "") + "</td>" +
      "<td dir='ltr'>" + esc(r.email || "—") + "</td>" +
      "<td dir='ltr'>" + esc(r.phone || "—") + "</td>" +
      "<td>" + esc(r.clinicName || "—") + "<br><span class='sub'>" + esc(r.clinicId) + "</span></td>" +
      "<td>" + esc(r.specialty || "—") + "</td>" +
      "<td><button class='btn btn-sm' data-users='" + esc(key) + "'>👥 " + (r.users == null ? "?" : r.users) + "</button></td>" +
      "<td>" + esc(c.startDate || "—") + "</td>" +
      "<td>" + esc(c.renewalDate || "—") + (c.renewalDate ? "<br><span class='sub'>" + countdown(c) + "</span>" : "") + "</td>" +
      "<td><span class='st st-" + r.status + "'>" + (r.archived ? "🗄️ مؤرشف" : ST[r.status]) + "</span></td>" +
      "<td>" + esc(offer || "—") + "</td>" +
      "<td>" + (c.price != null && c.price !== "" ? esc(finalPrice(c)) + (finalPrice(c) !== Number(c.price) ? "<br><s class='sub'>" + esc(c.price) + "</s>" : "") : "—") + "</td>" +
      "<td class='note-cell'>" + esc((c.notes || "").slice(0, 60)) + "</td>" +
      "<td>" + upd + "</td>" +
      "<td><button class='btn btn-sm' data-edit='" + esc(key) + "'>" + (r.c ? "✏️ تعديل" : "➕ إضافة اشتراك") + "</button></td>" +
      "</tr>";
  }).join("");
}
["cq"].forEach((id) => $(id).addEventListener("input", render));
["fSt", "fSpec", "fType", "fOffer", "fArch"].forEach((id) => $(id).addEventListener("change", render));
$("reload").addEventListener("click", loadAll);

const rowByKey = (k) => rows.find((r) => (r.c ? "c:" + r.c.id : "s:" + r.slug) === k);
$("cRows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit],[data-users]");
  if (!b) return;
  e.preventDefault();
  if (b.dataset.edit) openForm(rowByKey(b.dataset.edit));
  else openUsers(rowByKey(b.dataset.users));
});

/* ---------- add / edit form ---------- */
const F = ["cfName", "cfEmail", "cfPhone", "cfSpec", "cfClinicName", "cfClinicId", "cfSlug", "cfUrl", "cfDuration", "cfStart", "cfRenew",
  "cfPrice", "cfPay", "cfPayStatus", "cfDiscPct", "cfDiscVal", "cfFreeMonths", "cfSubNotes", "cfNotes", "cfOfferCustom"];

function fillSiteSelect(selected) {
  $("cfSite").innerHTML = '<option value="">— بدون موقع —</option>' +
    sites.map((s) => '<option value="' + esc(s.slug) + '">' + esc((s.settings.doctorName || s.slug) + " — /" + s.slug) + "</option>").join("");
  $("cfSite").value = selected || "";
}
$("cfSite").addEventListener("change", () => {
  const s = sites.find((x) => x.slug === val("cfSite"));
  if (!s) return;
  const st = s.settings || {};
  $("cfSlug").value = s.slug; $("cfClinicId").value = s.clinicId; $("cfUrl").value = siteUrl(s.slug);
  if (!val("cfName")) $("cfName").value = st.doctorName || "";
  if (!val("cfSpec")) $("cfSpec").value = st.specialty || "";
  if (!val("cfClinicName")) $("cfClinicName").value = st.clinicName || "";
  if (!val("cfPhone")) $("cfPhone").value = st.phone || "";
  if (!val("cfEmail")) $("cfEmail").value = s.doctorEmail || "";
});
$("cfOffer").addEventListener("change", () => $("cfOfferCustom").classList.toggle("hidden", val("cfOffer") !== "__custom"));
["cfPrice", "cfDiscPct", "cfDiscVal"].forEach((id) => $(id).addEventListener("input", showFinal));
function showFinal() { $("cfFinal").value = finalPrice({ price: num("cfPrice"), discountPercent: num("cfDiscPct"), discountValue: num("cfDiscVal") }); }

function openForm(r) {
  F.forEach((id) => { $(id).value = ""; });
  ["cfFreeSite", "cfFreePeriod"].forEach((id) => { $(id).checked = false; });
  $("cfType").value = "website"; $("cfStatus").value = "auto"; $("cfOffer").value = ""; $("cfOfferCustom").classList.add("hidden");
  say($("cfMsg"), "");
  const c = r && r.c;
  editingId = c ? c.id : null;
  $("cfTitle").textContent = c ? "✏️ تعديل العميل " + (c.customerNo || "") : "➕ إضافة عميل";
  $("cfArchive").classList.toggle("hidden", !c);
  $("cfArchive").textContent = c && c.archived ? "♻️ إلغاء الأرشفة" : "🗄️ أرشفة";
  fillSiteSelect(r ? r.slug : "");
  if (r) {
    $("cfName").value = r.name; $("cfEmail").value = r.email; $("cfPhone").value = r.phone; $("cfSpec").value = r.specialty;
    $("cfClinicName").value = r.clinicName; $("cfClinicId").value = r.clinicId; $("cfSlug").value = r.slug;
    $("cfUrl").value = (c && c.siteUrl) || (r.slug ? siteUrl(r.slug) : "");
  }
  if (c) {
    $("cfType").value = c.subscriptionType || "website"; $("cfStatus").value = c.manualStatus || "auto";
    $("cfDuration").value = c.durationMonths ?? ""; $("cfStart").value = c.startDate || ""; $("cfRenew").value = c.renewalDate || "";
    $("cfPrice").value = c.price ?? ""; $("cfPay").value = c.paymentMethod || ""; $("cfPayStatus").value = c.paymentStatus || "";
    const known = [...$("cfOffer").options].some((o) => o.value === c.offer || o.text === c.offer);
    if (c.offer && !known) { $("cfOffer").value = "__custom"; $("cfOfferCustom").value = c.offer; $("cfOfferCustom").classList.remove("hidden"); }
    else $("cfOffer").value = c.offer || "";
    $("cfDiscPct").value = c.discountPercent ?? ""; $("cfDiscVal").value = c.discountValue ?? "";
    $("cfFreeSite").checked = !!c.freeWebsite; $("cfFreePeriod").checked = !!c.freePeriod; $("cfFreeMonths").value = c.freeMonths ?? "";
    $("cfSubNotes").value = c.subscriptionNotes || ""; $("cfNotes").value = c.notes || "";
  }
  showFinal();
  $("custOverlay").classList.remove("hidden");
}
$("addCust").addEventListener("click", () => openForm(null));
$("cfClose").addEventListener("click", () => $("custOverlay").classList.add("hidden"));

// auto-fill renewal = start + duration (still editable)
["cfStart", "cfDuration"].forEach((id) => $(id).addEventListener("change", () => {
  const s = val("cfStart"), m = num("cfDuration");
  if (s && m && !val("cfRenew")) { const d = new Date(s + "T00:00:00"); d.setMonth(d.getMonth() + m); $("cfRenew").value = d.toISOString().slice(0, 10); }
}));

function nextCustomerNo() {
  const max = customers.reduce((n, c) => Math.max(n, parseInt(String(c.customerNo || "").replace(/\D/g, ""), 10) || 0), 0);
  return "C-" + String(max + 1).padStart(4, "0");
}

$("cfSave").addEventListener("click", async () => {
  const name = val("cfName");
  if (!name) { say($("cfMsg"), "اكتب اسم الدكتور.", "err"); return; }
  const email = val("cfEmail").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say($("cfMsg"), "الإيميل غير صحيح.", "err"); return; }
  const slug = val("cfSlug");
  if (slug && customers.some((c) => c.slug === slug && c.id !== editingId)) { say($("cfMsg"), "هذا الموقع مرتبط بعميل آخر بالفعل.", "err"); return; }
  const offer = val("cfOffer") === "__custom" ? val("cfOfferCustom") : val("cfOffer");
  const prev = editingId ? customers.find((c) => c.id === editingId) : null;
  const data = {
    doctorName: name, email, phone: val("cfPhone"), specialty: val("cfSpec"), clinicName: val("cfClinicName"),
    clinicId: val("cfClinicId"), slug, siteUrl: val("cfUrl"),
    subscriptionType: val("cfType"), manualStatus: val("cfStatus") === "auto" ? "" : val("cfStatus"),
    durationMonths: num("cfDuration"), startDate: val("cfStart"), renewalDate: val("cfRenew"),
    price: num("cfPrice"), paymentMethod: val("cfPay"), paymentStatus: val("cfPayStatus"),
    offer, discountPercent: num("cfDiscPct"), discountValue: num("cfDiscVal"),
    freeWebsite: $("cfFreeSite").checked, freePeriod: $("cfFreePeriod").checked, freeMonths: num("cfFreeMonths"),
    subscriptionNotes: val("cfSubNotes"), notes: $("cfNotes").value,
    updatedAt: Date.now(), updatedBy: me.email || me.uid, updatedByUid: me.uid,
  };
  data.finalPrice = finalPrice(data);
  try {
    say($("cfMsg"), "جارٍ الحفظ…");
    let id = editingId;
    if (!id) {
      data.customerNo = nextCustomerNo();
      data.createdAt = Date.now(); data.createdBy = me.email || me.uid; data.archived = false;
      id = data.customerNo;
    }
    await setDoc(doc(db, "customerSubscriptions", id), data, { merge: true });
    await audit(id, prev ? "update" : "create", prev, data);
    say($("cfMsg"), "تم الحفظ ✔", "ok");
    $("custOverlay").classList.add("hidden");
    loadAll();
  } catch (e) { say($("cfMsg"), "تعذر الحفظ: " + (e.code || e.message), "err"); }
});

$("cfArchive").addEventListener("click", async () => {
  if (!editingId) return;
  const c = customers.find((x) => x.id === editingId);
  const to = !(c && c.archived);
  if (to && !confirm("أرشفة هذا العميل؟ ستظل بياناته محفوظة ويمكن إظهاره من «إظهار المؤرشفين».")) return;
  try {
    await setDoc(doc(db, "customerSubscriptions", editingId), { archived: to, updatedAt: Date.now(), updatedBy: me.email || me.uid, updatedByUid: me.uid }, { merge: true });
    await audit(editingId, to ? "archive" : "unarchive", null, null);
    $("custOverlay").classList.add("hidden");
    loadAll();
  } catch (e) { say($("cfMsg"), "تعذر التنفيذ: " + (e.code || e.message), "err"); }
});

async function audit(id, action, before, after) {
  const changes = {};
  if (after) Object.keys(after).forEach((k) => {
    if (["updatedAt", "updatedBy", "updatedByUid"].includes(k)) return;
    const b = before ? before[k] : undefined;
    if (JSON.stringify(b) !== JSON.stringify(after[k])) changes[k] = { from: b == null ? null : b, to: after[k] == null ? null : after[k] };
  });
  try {
    await addDoc(collection(db, "customerSubscriptions", id, "audit"),
      { action, changes, at: Date.now(), by: me.email || "", byUid: me.uid });
  } catch (e) { console.warn("audit failed", e); }
}

/* ---------- linked users (existing Firebase accounts, UID = identity) ---------- */
const ROLE = { admin: "Admin (مدير العيادة)", owner: "Admin", doctor: "Doctor", user: "Reception / User", manager: "Manager", nurse: "Nurse", superadmin: "Super Admin", super_admin: "Super Admin" };
const fmtDate = (v) => { if (!v) return "—"; const d = typeof v === "number" ? new Date(v) : (v.toDate ? v.toDate() : new Date(v)); return isNaN(d) ? "—" : d.toLocaleDateString("ar-EG"); };

async function openUsers(r) {
  if (!r) return;
  usersCtx = r;
  $("uSub").textContent = (r.name || "") + (r.clinicId ? " — Clinic ID: " + r.clinicId : "");
  $("uRows").innerHTML = '<tr><td colspan="8" class="empty">جارٍ التحميل…</td></tr>';
  say($("uMsg"), "");
  $("usersOverlay").classList.remove("hidden");
  if (!r.clinicId) { $("uRows").innerHTML = '<tr><td colspan="8" class="empty">لا يوجد Clinic ID لهذا العميل.</td></tr>'; return; }
  const list = [];
  try {
    const u = await getDocs(query(collection(db, "users"), where("clinicId", "==", r.clinicId)));
    u.forEach((d) => list.push(Object.assign({ uid: d.id }, d.data())));
  } catch (e) { say($("uMsg"), "تعذرت قراءة المستخدمين: " + (e.code || e.message), "err"); }
  try {
    const m = await getDocs(query(collection(db, "clinicMembers"), where("clinicId", "==", r.clinicId)));
    m.forEach((d) => {
      if (list.some((x) => String(x.email || "").toLowerCase() === d.id.toLowerCase())) return;
      list.push(Object.assign({ uid: "", email: d.id, pending: true }, d.data()));
    });
  } catch { /* ignore */ }
  const notes = (r.c && r.c.userNotes) || {};
  if (!list.length) { $("uRows").innerHTML = '<tr><td colspan="8" class="empty">لا يوجد مستخدمون مرتبطون بهذه العيادة.</td></tr>'; return; }
  $("uRows").innerHTML = list.map((u) => {
    const k = u.uid || "email:" + u.email;
    const active = u.isActive !== false;
    return "<tr><td>" + esc(u.name || "—") + "</td><td dir='ltr'>" + esc(u.email || "—") + "</td>" +
      "<td dir='ltr' class='uid'>" + (u.uid ? esc(u.uid) : "<span class='sub'>دعوة — لم يسجل الدخول بعد</span>") + "</td>" +
      "<td>" + esc(ROLE[String(u.role || "user").toLowerCase()] || u.role || "Other") + "</td>" +
      "<td>" + fmtDate(u.createdAt) + "</td>" +
      "<td><span class='badge " + (active ? "on'>نشط" : "off'>موقوف") + "</span></td>" +
      "<td>" + fmtDate(u.lastLoginAt) + "</td>" +
      "<td><input type='text' data-unote='" + esc(k) + "' value='" + esc(notes[k] || "") + "' " + (r.c ? "" : "disabled placeholder='أضف اشتراك أولاً'") + " /></td></tr>";
  }).join("");
}
$("uClose").addEventListener("click", () => $("usersOverlay").classList.add("hidden"));
$("uSave").addEventListener("click", async () => {
  const r = usersCtx;
  if (!r || !r.c) { say($("uMsg"), "أضف اشتراك لهذا العميل أولاً لحفظ الملاحظات.", "err"); return; }
  const userNotes = {};
  document.querySelectorAll("[data-unote]").forEach((i) => { if (i.value.trim()) userNotes[i.dataset.unote] = i.value.trim(); });
  try {
    await setDoc(doc(db, "customerSubscriptions", r.c.id), { userNotes, updatedAt: Date.now(), updatedBy: me.email || me.uid, updatedByUid: me.uid }, { merge: true });
    await audit(r.c.id, "userNotes", null, null);
    r.c.userNotes = userNotes;
    say($("uMsg"), "تم الحفظ ✔", "ok");
  } catch (e) { say($("uMsg"), "تعذر الحفظ: " + (e.code || e.message), "err"); }
});

/* ---------- export (CSV with BOM so Excel shows Arabic) ---------- */
$("expCsv").addEventListener("click", () => {
  const head = ["Customer No", "Doctor Name", "Email", "Phone", "Clinic", "Clinic ID", "Website Slug", "Specialty", "Subscription Type",
    "Subscription Start", "Renewal Date", "Days Left", "Subscription Status", "Offer", "Price", "Final Price", "Payment Status", "Notes"];
  const lines = [head].concat(filtered().map((r) => {
    const c = r.c || {};
    return [r.no, r.name, r.email, r.phone, r.clinicName, r.clinicId, r.slug, r.specialty, TYPE[c.subscriptionType] || "",
      c.startDate || "", c.renewalDate || "", daysLeft(c.renewalDate) ?? "", r.archived ? "مؤرشف" : ST[r.status].replace(/^\S+\s/, ""),
      c.offer || "", c.price ?? "", c.price != null ? finalPrice(c) : "", c.paymentStatus || "", (c.notes || "").replace(/\s+/g, " ")];
  }));
  const csv = "\ufeff" + lines.map((l) => l.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "customers_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
});
