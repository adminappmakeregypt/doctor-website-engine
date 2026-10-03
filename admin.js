// ============ Doctor Website Engine v36 — admin dashboard ============
// Manages doctor websites: create, enable/disable, edit, delete.
// Same Firebase project / same data model as the public website.

import { app, adminAuth as auth, adminDb as db, adminStorage as storage } from "./firebase-config.js?v=25";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, where, limit, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- who may open this panel ---------- */
// إما دور superadmin/admin في users/{uid} أو بريد ضمن هذه القائمة.
const SUPER_ADMIN_EMAILS = [
  "mostafa.hegab83@gmail.com"
];
// Global (platform) admins only. Role "admin" in the Clinic app means CLINIC manager, not platform admin.
const ADMIN_ROLES = ["superadmin", "super_admin"];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const val = (id) => ($(id) ? $(id).value.trim() : "");
const slugify = (v) => String(v || "").trim().toLowerCase()
  .replace(/\s+/g, "-").replace(/[^a-z0-9\-\u0600-\u06FF]/g, "").replace(/-+/g, "-");

function say(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

function arabicError(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "بيانات الدخول غير صحيحة.";
  if (c.includes("too-many-requests")) return "محاولات كثيرة، حاول بعد قليل.";
  if (c.includes("email-already-in-use")) return "هذا البريد مستخدم بالفعل.";
  if (c.includes("weak-password")) return "كلمة المرور قصيرة (٦ أحرف على الأقل).";
  if (c.includes("permission-denied")) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  return (e && e.message) ? e.message : "حدث خطأ غير متوقع.";
}

/* ---------- state ---------- */
let editing = null;
let sites = [];        // [{ clinicId, slug, settings, servicesCount }]
let currentUser = null;
let editServices = [];
const DAYS = [["saturday", "السبت"], ["sunday", "الأحد"], ["monday", "الإثنين"], ["tuesday", "الثلاثاء"], ["wednesday", "الأربعاء"], ["thursday", "الخميس"], ["friday", "الجمعة"]];

/* ================= AUTH ================= */
$("liBtn").addEventListener("click", doLogin);
$("liPass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("liEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

async function doLogin() {
  const msg = $("liMsg");
  say(msg, "جارٍ الدخول…");
  try {
    await signInWithEmailAndPassword(auth, val("liEmail"), $("liPass").value);
    say(msg, "");
  } catch (e) {
    say(msg, arabicError(e), "err");
  }
}

$("liForgot").addEventListener("click", async () => {
  const email = val("liEmail");
  const msg = $("liMsg");
  if (!email) { say(msg, "اكتب بريدك الإلكتروني أولاً.", "err"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    say(msg, "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك ✔", "ok");
  } catch (e) { say(msg, arabicError(e), "err"); }
});

$("outBtn").addEventListener("click", () => signOut(auth));

async function isAdmin(user) {
  if (!user) return false;
  const email = String(user.email || "").toLowerCase();
  if (SUPER_ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(email)) return true;
  try {
    const d = await getDoc(doc(db, "users", user.uid));
    if (d.exists()) {
      const role = String(d.data().role || "").toLowerCase();
      if (ADMIN_ROLES.includes(role)) return true;
    }
  } catch (e) { /* قواعد الأمان قد تمنع القراءة */ }
  return false;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    $("panel").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    return;
  }
  const ok = await isAdmin(user);
  if (!ok) {
    say($("liMsg"), "هذا الحساب لا يملك صلاحية المدير.", "err");
    currentUser = null;
    $("panel").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    return;
  }
  currentUser = user;
  $("whoEmail").textContent = user.email || "";
  $("loginScreen").classList.add("hidden");
  $("panel").classList.remove("hidden");
  loadSites();
});

/* ================= LOAD ================= */
async function loadSites() {
  $("rows").innerHTML = '<tr><td colspan="7" class="empty">جارٍ التحميل…</td></tr>';
  const found = new Map(); // slug -> { clinicId, slug, doctorId } (a clinic may have several doctor sites)

  try {
    const dir = await getDocs(collection(db, "websiteDirectory"));
    dir.forEach((d) => {
      const data = d.data() || {};
      const clinicId = data.clinicId || d.id;
      found.set(d.id, { clinicId, slug: data.slug || d.id, doctorId: data.doctorId || "",
        ownerUid: data.ownerUid || "", doctorEmail: String(data.doctorEmail || "").toLowerCase() });
    });
  } catch (e) { /* ignore */ }
  await migrateOwners([...found.values()]);

  const out = [];
  for (const entry of found.values()) {
    let settings = {}, servicesCount = 0;
    try {
      const s = await getDoc(doc(db, "clinics", entry.clinicId, "websiteSettings", "main"));
      if (s.exists()) settings = s.data() || {};
    } catch (e) { /* ignore */ }
    try {
      const sv = await getDocs(collection(db, "clinics", entry.clinicId, "services"));
      servicesCount = sv.size;
    } catch (e) { /* ignore */ }
    out.push({ clinicId: entry.clinicId, slug: entry.slug, doctorId: entry.doctorId, ownerUid: entry.ownerUid || "", doctorEmail: entry.doctorEmail || "", settings, servicesCount });
  }

  out.sort((a, b) => String(a.settings.doctorName || a.slug).localeCompare(String(b.settings.doctorName || b.slug), "ar"));
  sites = out;
  renderStats();
  renderRows();
}

$("reloadBtn").addEventListener("click", loadSites);
$("q").addEventListener("input", renderRows);
$("fStatus").addEventListener("change", renderRows);

function renderStats() {
  const on = sites.filter((s) => s.settings.isWebsiteEnabled !== false).length;
  $("stTotal").textContent = sites.length;
  $("stOn").textContent = on;
  $("stOff").textContent = sites.length - on;
  $("stServices").textContent = sites.reduce((n, s) => n + (s.servicesCount || 0), 0);
}

function siteUrl(slug) {
  const base = location.href.replace(/admin\.html.*$/, "");
  return base + "index.html?slug=" + encodeURIComponent(slug);
}

function renderRows() {
  const q = val("q").toLowerCase();
  const st = val("fStatus");
  const list = sites.filter((s) => {
    const enabled = s.settings.isWebsiteEnabled !== false;
    if (st === "on" && !enabled) return false;
    if (st === "off" && enabled) return false;
    if (!q) return true;
    return [s.slug, s.clinicId, s.settings.doctorName, s.settings.specialty, s.settings.clinicName]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  if (!list.length) {
    $("rows").innerHTML = '<tr><td colspan="7" class="empty">لا توجد مواقع مطابقة.</td></tr>';
    return;
  }

  $("rows").innerHTML = list.map((s) => {
    const on = s.settings.isWebsiteEnabled !== false;
    return "<tr>" +
      "<td><strong>" + esc(s.settings.doctorName || "—") + "</strong><br><span class='sub'>" + esc(s.clinicId) + "</span></td>" +
      "<td>" + esc(s.settings.specialty || "—") + "</td>" +
      "<td>" + esc(s.settings.clinicName || "—") + "</td>" +
      "<td><a class='slug-link' target='_blank' rel='noopener' href='" + esc(siteUrl(s.slug)) + "'>/" + esc(s.slug) + "</a></td>" +
      "<td>" + (s.servicesCount || 0) + "</td>" +
      "<td><span class='badge " + (on ? "on'>مُفعّل" : "off'>متوقف") + "</span></td>" +
      "<td><div class='row-acts'>" +
        "<button class='btn btn-sm' data-act='edit' data-id='" + esc(s.slug) + "'>✏️ تعديل</button>" +
        "<button class='btn btn-sm' data-act='account' data-id='" + esc(s.slug) + "'>🔑 حساب الطبيب</button>" +
        "<button class='btn btn-sm' data-act='toggle' data-id='" + esc(s.slug) + "'>" + (on ? "⏸️ إيقاف" : "▶️ تفعيل") + "</button>" +
        "<button class='btn btn-sm btn-danger' data-act='del' data-id='" + esc(s.slug) + "'>🗑️ حذف</button>" +
      "</div></td>" +
    "</tr>";
  }).join("");

  $("rows").querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => rowAction(b.dataset.act, b.dataset.id));
  });
}

const findSite = (slug) => sites.find((s) => s.slug === slug);

async function rowAction(act, slug) {
  const s = findSite(slug);
  if (!s) return;
  const clinicId = s.clinicId;
  if (act === "edit") return openEdit(s);
  if (act === "account") return linkAccount(s);
  if (act === "toggle") {
    const next = !(s.settings.isWebsiteEnabled !== false);
    await setDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"),
      { isWebsiteEnabled: next, updatedAt: Date.now() }, { merge: true });
    s.settings.isWebsiteEnabled = next;
    renderStats(); renderRows();
    return;
  }
  if (act === "del") {
    const name = s.settings.doctorName || s.slug;
    if (!confirm("حذف موقع «" + name + "»؟\nسيتم حذف إعدادات الموقع والرابط فقط — لا تُحذف بيانات العيادة أو المرضى.")) return;
    try {
      const shared = sites.some((x) => x.clinicId === clinicId && x.slug !== s.slug);
      if (!shared) await deleteDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"));
      if (s.slug) await deleteDoc(doc(db, "websiteDirectory", s.slug));
      // إيقاف حسابات الأطباء المرتبطة (حذف حساب الدخول نفسه يتم من Firebase Console)
      let disabled = 0;
      if (!shared) try {
        const us = await getDocs(query(collection(db, "users"), where("clinicId", "==", clinicId), where("role", "==", "doctor")));
        for (const u of us.docs) {
          await setDoc(u.ref, { isActive: false, websiteDeletedAt: Date.now() }, { merge: true });
          disabled++;
        }
      } catch (e) { /* ignore */ }
      if (disabled) alert("تم حذف الموقع وإيقاف " + disabled + " حساب طبيب مرتبط.\nلحذف حساب الدخول نهائياً: Firebase Console ← Authentication.");
      sites = sites.filter((x) => x.slug !== s.slug);
      renderStats(); renderRows();
    } catch (e) { alert(arabicError(e)); }
  }
}

/* ================= صور: لوجو العيادة وصورة الطبيب ================= */
function showPreview(previewId, url) {
  const img = $(previewId);
  if (!img) return;
  if (url) { img.src = url; img.classList.add("show"); }
  else { img.removeAttribute("src"); img.classList.remove("show"); }
}

async function uploadImage(file, clinicId, folder) {
  const path = "clinics/" + clinicId + "/attachments/website/" + folder + "/" + Date.now() + "_" + file.name.replace(/[^\w.\-]+/g, "_");
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

function wireUpload(fileId, urlId, previewId, folder, msgId, getClinicId) {
  const input = $(fileId);
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const cid = getClinicId();
    const msg = $(msgId);
    if (!cid) return say(msg, "اكتب معرّف العيادة (clinicId) أولاً ثم ارفع الصورة.", "err");
    say(msg, "جارٍ رفع الصورة…");
    try {
      const url = await uploadImage(file, cid, folder);
      $(urlId).value = url;
      showPreview(previewId, url);
      say(msg, "تم رفع الصورة ✔", "ok");
    } catch (e) { say(msg, arabicError(e), "err"); }
  });
}

wireUpload("upNLogo", "nLogo", "pvNLogo", "logo", "addMsg", () => val("nClinicId"));
wireUpload("upNProfile", "nProfile", "pvNProfile", "profile", "addMsg", () => val("nClinicId"));
wireUpload("upELogo", "edLogo", "pvELogo", "logo", "edMsg", () => (editing ? editing.clinicId : ""));
wireUpload("upEProfile", "edProfile", "pvEProfile", "profile", "edMsg", () => (editing ? editing.clinicId : ""));
wireUpload("upECover", "edCover", "pvECover", "cover", "edMsg", () => (editing ? editing.clinicId : ""));

[["nLogo", "pvNLogo"], ["nProfile", "pvNProfile"], ["edLogo", "pvELogo"], ["edProfile", "pvEProfile"], ["edCover", "pvECover"]]
  .forEach(([id, pv]) => { if ($(id)) $(id).addEventListener("input", () => showPreview(pv, val(id))); });

/* ============ v25: ملكية الموقع بمعرّف Firebase (UID) ============ */
async function setOwner(slug, clinicId, uid) {
  if (!uid || !clinicId) return;
  if (slug) await setDoc(doc(db, "websiteDirectory", slug), { ownerUid: uid, updatedAt: Date.now() }, { merge: true });
  await setDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"), { ownerUids: arrayUnion(uid) }, { merge: true });
}
// ترحيل آمن: المواقع القديمة المرتبطة بالبريد فقط تُربط بـ UID صاحب البريد من users/{uid}.
async function migrateOwners(entries) {
  for (const e of entries) {
    if (e.ownerUid || !e.doctorEmail) continue;
    try {
      const u = await getDocs(query(collection(db, "users"), where("email", "==", e.doctorEmail), limit(1)));
      if (!u.empty) { await setOwner(e.slug, e.clinicId, u.docs[0].id); e.ownerUid = u.docs[0].id; }
    } catch (err) { /* ignore — retried next load */ }
  }
}

/* ============ حساب الطبيب: إنشاء أو ربط (بتطبيق ثانوي) ============ */
// يعيد uid. إن كان البريد مستخدماً مسبقاً يحاول الدخول بكلمة المرور نفسها لربطه.
async function createOrLinkDoctorAccount(email, pass, name, clinicId) {
  const second = initializeApp(app.options, "admin-acc-" + Date.now());
  const secondAuth = getAuth(second);
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(secondAuth, email, pass);
    } catch (e) {
      if (String(e && e.code).includes("email-already-in-use")) {
        cred = await signInWithEmailAndPassword(secondAuth, email, pass);
      } else throw e;
    }
    // v32: users/{uid} هو السجل الأساسي المشترك مع تطبيق العيادة.
    // لا نُنشئ سجلاً مكرراً ولا نُخفّض دور مدير عيادة موجود ولا ننقله لعيادة أخرى.
    const uref = doc(db, "users", cred.user.uid);
    const cur = await getDoc(uref);
    const lower = String(email).toLowerCase();
    let role = "doctor";
    if (cur.exists()) {
      const d = cur.data();
      if (d.clinicId && d.clinicId !== clinicId) {
        throw new Error("هذا الحساب مرتبط بعيادة أخرى (" + d.clinicId + ") — لا يمكن ربطه بـ " + clinicId);
      }
      const r = String(d.role || "").toLowerCase();
      if (["admin", "owner", "doctor", "superadmin", "super_admin"].includes(r)) role = r;
    }
    await setDoc(uref, {
      email: lower, name: (cur.exists() && cur.data().name) || name, role, clinicId,
      isActive: true, updatedAt: Date.now()
    }, { merge: true });
    // جسر البريد لنفس الحساب (للتوافق فقط؛ سجل UID له الأولوية دائماً)
    await setDoc(doc(db, "clinicMembers", lower), {
      clinicId, role, name, isActive: true, updatedAt: Date.now()
    }, { merge: true });
    try { await signOut(secondAuth); } catch (e) { /* ignore */ }
    return cred.user.uid;
  } finally {
    try { await deleteApp(second); } catch (e) { /* ignore */ }
  }
}

/* ============ الطبيب المرتبط بالحجز (معرّف ثابت من تطبيق العيادة) ============ */
async function fillDoctorSelect(selId, clinicId, current) {
  const sel = $(selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— بدون حجز أونلاين —</option>';
  if (!clinicId) return;
  try {
    const pa = await getDoc(doc(db, "clinics", clinicId, "publicAvailability", "main"));
    const list = pa.exists() ? (pa.data().doctors || []).filter((d) => d && d.id) : [];
    if (!list.length) {
      sel.innerHTML += '<option value="" disabled>افتح تطبيق العيادة مرة واحدة لنشر قائمة الأطباء</option>';
    }
    list.forEach((d) => {
      const o = document.createElement("option");
      o.value = d.id; o.textContent = d.name + " (" + d.id + ")";
      sel.appendChild(o);
    });
    if (!current && list.length === 1) current = list[0].id;
    if (current && !list.some((d) => d.id === current)) {
      const o = document.createElement("option");
      o.value = current; o.textContent = current + " (غير موجود حاليًا)"; sel.appendChild(o);
    }
    sel.value = current || "";
  } catch (e) { /* ignore */ }
}
const selectedDoctorName = (selId) => {
  const sel = $(selId); if (!sel || !sel.value) return "";
  return sel.options[sel.selectedIndex].textContent.replace(/\s*\([^)]*\)\s*$/, "");
};
if ($("nClinicId")) $("nClinicId").addEventListener("change", () => fillDoctorSelect("nDoctorId", val("nClinicId"), ""));
if ($("edClinicId")) $("edClinicId").addEventListener("change", () => fillDoctorSelect("edDoctorId", val("edClinicId"), ""));

/* ================= ADD ================= */
$("addBtn").addEventListener("click", addDoctor);

async function addDoctor() {
  const msg = $("addMsg");
  const name = val("nName");
  const slug = slugify(val("nSlug"));
  const clinicId = val("nClinicId");
  const email = val("nEmail");
  const pass = $("nPass").value;

  if (!name) return say(msg, "اكتب اسم الطبيب.", "err");
  if (!slug) return say(msg, "اكتب رابط الموقع (slug).", "err");
  if (!clinicId) return say(msg, "اكتب معرّف العيادة (clinicId).", "err");
  if (sites.some((s) => s.slug === slug)) return say(msg, "هذا الرابط مستخدم بالفعل، اختر رابطاً آخر.", "err");
  if (sites.some((s) => s.clinicId === clinicId) &&
      !confirm("هذه العيادة لها موقع بالفعل. إنشاء موقع لطبيب آخر في نفس العيادة؟\n(بيانات الصفحة مشتركة بين مواقع العيادة، والحجز منفصل لكل طبيب.)")) return;

  if ((email && !pass) || (!email && pass)) return say(msg, "لإنشاء حساب دخول الطبيب اكتب البريد وكلمة المرور معاً، أو اتركهما فارغين.", "err");

  say(msg, "جارٍ الإنشاء…");
  try {
    // ١) حساب الطبيب أولاً — إن فشل لا يُنشأ أي شيء (لا مواقع ناقصة)
    let accountNote = "", ownerUid = "";
    if (email && pass) {
      say(msg, "جارٍ إنشاء حساب دخول الطبيب…");
      ownerUid = await createOrLinkDoctorAccount(email, pass, name, clinicId);
      accountNote = " وتم إنشاء حساب دخول الطبيب.";
    }
    say(msg, "جارٍ إنشاء الموقع…");
    const settings = {
      isWebsiteEnabled: $("nEnabled").checked,
      slug,
      doctorName: name,
      doctorTitle: "",
      specialty: val("nSpec"),
      subSpecialty: "",
      clinicName: val("nClinicName"),
      phone: val("nPhone"),
      whatsapp: val("nWa"),
      email,
      address: val("nAddress"),
      profileImage: val("nProfile"), coverImage: "", logo: val("nLogo"),
      aboutDoctor: "", qualifications: "", experience: "",
      googleMapsUrl: val("nMaps"),
      socialMedia: {
        facebook: val("nFacebook"),
        instagram: val("nInstagram")
      },
      workingHours: {},
      themeSettings: { primaryColor: "#0f766e" },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await setDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"), settings, { merge: true });
    await setDoc(doc(db, "websiteDirectory", slug),
      { clinicId, slug, doctorId: ($("nDoctorId") && $("nDoctorId").value) || "",
        doctorEmail: String(email || "").toLowerCase(), updatedAt: Date.now() },
      { merge: true });
    if (ownerUid) await setOwner(slug, clinicId, ownerUid);


    say(msg, "تم إنشاء الموقع ✔" + accountNote + " الرابط: /" + slug, "ok");
    ["nName", "nSpec", "nClinicName", "nSlug", "nClinicId", "nPhone", "nWa", "nEmail", "nPass", "nAddress", "nMaps", "nFacebook", "nInstagram", "nLogo", "nProfile"]
      .forEach((id) => { if ($(id)) $(id).value = ""; });
    showPreview("pvNLogo", ""); showPreview("pvNProfile", "");
    await loadSites();
    const created = findSite(slug);
    if (created) await openEdit(created);
  } catch (e) {
    say(msg, arabicError(e), "err");
  }
}

/* ================= COMPLETE SITE EDITOR ================= */
const setVal = (id, value) => { if ($(id)) $(id).value = value == null ? "" : value; };

function parseReviews(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 30).map((line) => {
    const i = line.indexOf("|");
    return i < 0 ? { name: "", text: line.slice(0, 500) }
      : { name: line.slice(0, i).trim().slice(0, 80), text: line.slice(i + 1).trim().slice(0, 500) };
  }).filter((review) => review.text);
}

function reviewsText(reviews) {
  return (Array.isArray(reviews) ? reviews : []).map((review) =>
    (review.name || "") + " | " + (review.text || review.comment || "")
  ).join("\n");
}

function renderEditorHours(workingHours) {
  const current = {};
  if (workingHours && !Array.isArray(workingHours)) Object.assign(current, workingHours);
  if (Array.isArray(workingHours)) {
    workingHours.forEach((row) => {
      const match = DAYS.find(([key, label]) => row.day === label || row.day === key || row.label === label);
      if (match) current[match[0]] = row;
    });
  }
  $("edHoursRows").innerHTML = DAYS.map(([key, label]) => {
    const row = current[key] || {};
    const closed = row.closed === true || row.isClosed === true;
    return '<tr data-day="' + key + '"><td>' + esc(label) + '</td>' +
      '<td><input type="time" class="h-open" value="' + esc(row.open || row.from || "") + '" /></td>' +
      '<td><input type="time" class="h-close" value="' + esc(row.close || row.to || "") + '" /></td>' +
      '<td><input type="checkbox" class="h-closed"' + (closed ? " checked" : "") + ' /></td></tr>';
  }).join("");
}

function collectEditorHours() {
  const result = {};
  $("edHoursRows").querySelectorAll("tr").forEach((row) => {
    const open = row.querySelector(".h-open").value;
    const close = row.querySelector(".h-close").value;
    const closed = row.querySelector(".h-closed").checked;
    if (!closed && !open && !close) return;
    result[row.dataset.day] = { open, close, closed };
  });
  return result;
}

async function loadEditorServices() {
  editServices = [];
  if (!editing) return renderEditorServices();
  try {
    const snap = await getDocs(collection(db, "clinics", editing.clinicId, "services"));
    editServices = snap.docs.map((item) => Object.assign({ id: item.id }, item.data()));
    editServices.sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) { say($("edSvMsg"), arabicError(e), "err"); }
  renderEditorServices();
}

function renderEditorServices() {
  if (!editServices.length) {
    $("edSvRows").innerHTML = '<tr><td colspan="6" class="empty">لا توجد خدمات بعد.</td></tr>';
    return;
  }
  $("edSvRows").innerHTML = editServices.map((service) => {
    const active = service.isActive !== false;
    return "<tr><td><b>" + esc(service.name || "") + "</b></td><td>" + esc(service.description || "—") +
      "</td><td>" + esc(service.price || "—") + "</td><td>" + esc(service.duration || "—") +
      '</td><td><span class="badge ' + (active ? "on" : "off") + '">' + (active ? "ظاهرة" : "مخفية") +
      '</span></td><td><div class="row-acts"><button class="btn btn-sm" data-ed-service="toggle" data-id="' + esc(service.id) + '">' +
      (active ? "إخفاء" : "إظهار") + '</button><button class="btn btn-sm btn-danger" data-ed-service="delete" data-id="' +
      esc(service.id) + '">🗑️ حذف</button></div></td></tr>';
  }).join("");
}

function activateAdminTab(paneId) {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("active", button.dataset.adminTab === paneId));
  document.querySelectorAll(".admin-tabpane").forEach((pane) => pane.classList.toggle("hidden", pane.id !== paneId));
}

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => activateAdminTab(button.dataset.adminTab));
});

async function openEdit(site) {
  editing = site;
  const data = site.settings || {};
  const social = data.socialMedia || {};
  const theme = data.themeSettings || {};
  $("edTitle").textContent = "إعداد الموقع بالكامل: " + (data.doctorName || site.slug);
  setVal("edName", data.doctorName); setVal("edTitleF", data.doctorTitle);
  setVal("edSpec", data.specialty); setVal("edSubSpec", data.subSpecialty);
  setVal("edClinicName", data.clinicName); setVal("edSlug", site.slug); setVal("edClinicId", site.clinicId);
  setVal("edPhone", data.phone); setVal("edWa", data.whatsapp); setVal("edEmail", data.email || site.doctorEmail);
  setVal("edAddress", data.address); setVal("edMaps", data.googleMapsUrl); setVal("edBookingUrl", data.bookingUrl);
  setVal("edFacebook", social.facebook); setVal("edInstagram", social.instagram);
  setVal("edTwitter", social.twitter || social.x); setVal("edYoutube", social.youtube);
  setVal("edTiktok", social.tiktok); setVal("edLinkedin", social.linkedin);
  setVal("edProfile", data.profileImage); setVal("edCover", data.coverImage); setVal("edLogo", data.logo);
  setVal("edShortIntro", data.shortIntro); setVal("edAboutDoctor", data.aboutDoctor);
  setVal("edQualifications", data.qualifications); setVal("edExperience", data.experience);
  setVal("edReviews", reviewsText(data.reviews));
  setVal("edPrimaryColor", /^#[0-9a-fA-F]{6}$/.test(theme.primaryColor || "") ? theme.primaryColor : "#0f766e");
  setVal("edEnabled", data.isWebsiteEnabled !== false ? "1" : "0");
  $("edOnlineBooking").checked = data.onlineBookingEnabled !== false;
  setVal("edBookingInstructions", data.bookingInstructions);
  showPreview("pvELogo", data.logo || ""); showPreview("pvEProfile", data.profileImage || ""); showPreview("pvECover", data.coverImage || "");
  renderEditorHours(data.workingHours);
  $("edViewSite").href = siteUrl(site.slug);
  await fillDoctorSelect("edDoctorId", site.clinicId, site.doctorId || "");
  say($("edMsg"), ""); say($("edSvMsg"), "");
  activateAdminTab("edProfilePane");
  $("editOverlay").classList.remove("hidden");
  await loadEditorServices();
}

$("edClose").addEventListener("click", () => {
  $("editOverlay").classList.add("hidden");
  editing = null; editServices = [];
});

$("edSvAdd").addEventListener("click", async () => {
  if (!editing) return;
  const name = val("edSvName");
  if (!name) return say($("edSvMsg"), "اكتب اسم الخدمة أولاً.", "err");
  const data = { name, description: val("edSvDesc"), price: val("edSvPrice"), duration: val("edSvDuration"), isActive: true, order: editServices.length + 1, createdAt: Date.now() };
  say($("edSvMsg"), "جارٍ الإضافة…");
  try {
    const result = await addDoc(collection(db, "clinics", editing.clinicId, "services"), data);
    editServices.push(Object.assign({ id: result.id }, data));
    ["edSvName", "edSvDesc", "edSvPrice", "edSvDuration"].forEach((id) => setVal(id, ""));
    editing.servicesCount = editServices.length;
    renderEditorServices(); renderStats(); renderRows();
    say($("edSvMsg"), "تمت إضافة الخدمة ✔", "ok");
  } catch (e) { say($("edSvMsg"), arabicError(e), "err"); }
});

$("edSvRows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-ed-service]");
  if (!button || !editing) return;
  const service = editServices.find((item) => item.id === button.dataset.id);
  if (!service) return;
  try {
    if (button.dataset.edService === "toggle") {
      const active = service.isActive !== false;
      await updateDoc(doc(db, "clinics", editing.clinicId, "services", service.id), { isActive: !active, updatedAt: Date.now() });
      service.isActive = !active;
      say($("edSvMsg"), "تم تحديث الخدمة ✔", "ok");
    } else {
      if (!confirm("حذف الخدمة «" + (service.name || "") + "»؟")) return;
      await deleteDoc(doc(db, "clinics", editing.clinicId, "services", service.id));
      editServices = editServices.filter((item) => item.id !== service.id);
      editing.servicesCount = editServices.length;
      renderStats(); renderRows();
      say($("edSvMsg"), "تم حذف الخدمة ✔", "ok");
    }
    renderEditorServices();
  } catch (e) { say($("edSvMsg"), arabicError(e), "err"); }
});

async function syncEditorHours(site, workingHours) {
  if (!site.doctorId) return;
  const doctorsRef = doc(db, "clinics", site.clinicId, "appData", "clinic_doctors_v1");
  const snap = await getDoc(doctorsRef);
  const raw = snap.exists() ? (snap.data() || {}) : {};
  let list = [];
  try { list = JSON.parse(raw.json || "[]"); } catch (e) { list = []; }
  const doctor = Array.isArray(list) ? list.find((item) => item && item.id === site.doctorId) : null;
  if (!doctor) return;
  const dayIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const days = [], dayHours = {};
  let start = "", end = "";
  Object.keys(dayIndex).forEach((key) => {
    const row = workingHours[key];
    if (!row || row.closed || !row.open || !row.close) return;
    const day = dayIndex[key]; days.push(day); dayHours[day] = { start: row.open, end: row.close };
    if (!start || row.open < start) start = row.open;
    if (!end || row.close > end) end = row.close;
  });
  if (!days.length || !start || !end) return;
  doctor.schedule = Object.assign({}, doctor.schedule || {}, { start, end, days, dayHours });
  await setDoc(doctorsRef, { json: JSON.stringify(list), updatedAt: new Date().toISOString(), updatedBy: (currentUser && currentUser.email) || "website-admin" });
}

$("edSave").addEventListener("click", async () => {
  if (!editing) return;
  const msg = $("edMsg");
  const oldSlug = editing.slug;
  const oldClinicId = editing.clinicId;
  const newSlug = slugify(val("edSlug"));
  const newClinicId = val("edClinicId");
  if (!newSlug) return say(msg, "الرابط مطلوب.", "err");
  if (!newClinicId) return say(msg, "معرّف العيادة مطلوب.", "err");
  if (newSlug !== oldSlug && sites.some((site) => site.slug === newSlug)) return say(msg, "هذا الرابط مستخدم بالفعل.", "err");
  const workingHours = collectEditorHours();
  const hoursChanged = JSON.stringify(workingHours) !== JSON.stringify(editing.settings.workingHours || {});
  const patch = {
    doctorName: val("edName"), doctorTitle: val("edTitleF"), specialty: val("edSpec"), subSpecialty: val("edSubSpec"), clinicName: val("edClinicName"),
    profileImage: val("edProfile"), coverImage: val("edCover"), logo: val("edLogo"), shortIntro: val("edShortIntro"), aboutDoctor: val("edAboutDoctor"),
    qualifications: val("edQualifications"), experience: val("edExperience"), reviews: parseReviews(val("edReviews")), phone: val("edPhone"), whatsapp: val("edWa"),
    email: val("edEmail"), address: val("edAddress"), googleMapsUrl: val("edMaps"), bookingUrl: val("edBookingUrl"),
    socialMedia: { facebook: val("edFacebook"), instagram: val("edInstagram"), twitter: val("edTwitter"), youtube: val("edYoutube"), tiktok: val("edTiktok"), linkedin: val("edLinkedin") },
    themeSettings: Object.assign({}, editing.settings.themeSettings || {}, { primaryColor: val("edPrimaryColor") }),
    workingHours, ...(hoursChanged ? { hoursSource: "website", hoursUpdatedAt: Date.now() } : {}),
    slug: newSlug, isWebsiteEnabled: val("edEnabled") === "1", onlineBookingEnabled: $("edOnlineBooking").checked,
    bookingInstructions: val("edBookingInstructions").slice(0, 300), bookingDoctorName: selectedDoctorName("edDoctorId"), updatedAt: Date.now()
  };
  say(msg, "جارٍ حفظ الموقع بالكامل…");
  try {
    const fullSettings = Object.assign({}, editing.settings || {}, patch);
    if (oldClinicId !== newClinicId && editServices.length) {
      const move = confirm("تم تغيير معرّف العيادة. هل تريد نسخ خدمات الموقع الحالية إلى العيادة الجديدة؟");
      if (!move) return say(msg, "لم يتم الحفظ حتى لا تُترك الخدمات في العيادة القديمة.", "err");
      for (const service of editServices) {
        const copy = Object.assign({}, service);
        delete copy.id;
        await setDoc(doc(db, "clinics", newClinicId, "services", service.id), copy, { merge: true });
      }
    }
    await setDoc(doc(db, "clinics", newClinicId, "websiteSettings", "main"), fullSettings, { merge: true });
    const doctorId = val("edDoctorId");
    const directory = { clinicId: newClinicId, slug: newSlug, doctorId, doctorEmail: String(val("edEmail") || editing.doctorEmail || "").toLowerCase(), ownerUid: editing.ownerUid || "", updatedAt: Date.now() };
    await setDoc(doc(db, "websiteDirectory", newSlug), directory, { merge: true });
    if (newSlug !== oldSlug && oldSlug) await deleteDoc(doc(db, "websiteDirectory", oldSlug));
    editing.slug = newSlug; editing.clinicId = newClinicId; editing.doctorId = doctorId;
    editing.doctorEmail = directory.doctorEmail; editing.settings = fullSettings;
    $("edViewSite").href = siteUrl(newSlug);
    if (hoursChanged) await syncEditorHours(editing, workingHours);
    renderStats(); renderRows();
    say(msg, "تم حفظ الموقع بالكامل ✔ ويمكن للطبيب تعديله الآن.", "ok");
  } catch (e) { say(msg, arabicError(e), "err"); }
});

/* ================= ربط / إصلاح حساب الطبيب ================= */
async function linkAccount(s) {
  const name = s.settings.doctorName || s.slug;
  const email = (prompt("بريد دخول الطبيب «" + name + "»:", s.settings.email || "") || "").trim();
  if (!email) return;
  const pass = prompt("كلمة المرور:\n• حساب جديد: اكتب كلمة مرور جديدة (٦ أحرف على الأقل).\n• حساب موجود: اكتب كلمة مروره الحالية لربطه بهذا الموقع.") || "";
  if (!pass) return;
  try {
    const uid = await createOrLinkDoctorAccount(email, pass, name, s.clinicId);
    if (s.slug) {
      await setDoc(doc(db, "websiteDirectory", s.slug),
        { clinicId: s.clinicId, slug: s.slug, doctorEmail: email.toLowerCase(), updatedAt: Date.now() }, { merge: true });
    }
    await setOwner(s.slug, s.clinicId, uid);
    alert("تم ربط حساب الطبيب بالموقع ✔\nيمكنه الآن الدخول إلى doctor.html");
  } catch (e) { alert("تعذر ربط الحساب: " + arabicError(e)); }
}
