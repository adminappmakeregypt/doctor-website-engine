// ============ Doctor Website Engine — admin dashboard ============
// Manages doctor websites: create, enable/disable, edit, delete.
// Same Firebase project / same data model as the public website.

import { app, auth, db, storage } from "./firebase-config.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- who may open this panel ---------- */
// إما دور superadmin/admin في users/{uid} أو بريد ضمن هذه القائمة.
const SUPER_ADMIN_EMAILS = [
  "mostafa.hegab83@gmail.com"
];
const ADMIN_ROLES = ["superadmin", "super_admin", "admin", "owner"];

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
    await signOut(auth);
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
  const found = new Map(); // clinicId -> { clinicId, slug }

  try {
    const dir = await getDocs(collection(db, "websiteDirectory"));
    dir.forEach((d) => {
      const data = d.data() || {};
      const clinicId = data.clinicId || d.id;
      found.set(clinicId, { clinicId, slug: data.slug || d.id });
    });
  } catch (e) { /* ignore */ }

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
    out.push({ clinicId: entry.clinicId, slug: settings.slug || entry.slug, settings, servicesCount });
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
        "<button class='btn btn-sm' data-act='edit' data-id='" + esc(s.clinicId) + "'>✏️ تعديل</button>" +
        "<button class='btn btn-sm' data-act='toggle' data-id='" + esc(s.clinicId) + "'>" + (on ? "⏸️ إيقاف" : "▶️ تفعيل") + "</button>" +
        "<button class='btn btn-sm btn-danger' data-act='del' data-id='" + esc(s.clinicId) + "'>🗑️ حذف</button>" +
      "</div></td>" +
    "</tr>";
  }).join("");

  $("rows").querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => rowAction(b.dataset.act, b.dataset.id));
  });
}

const findSite = (clinicId) => sites.find((s) => s.clinicId === clinicId);

async function rowAction(act, clinicId) {
  const s = findSite(clinicId);
  if (!s) return;
  if (act === "edit") return openEdit(s);
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
      await deleteDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"));
      if (s.slug) await deleteDoc(doc(db, "websiteDirectory", s.slug));
      sites = sites.filter((x) => x.clinicId !== clinicId);
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

[["nLogo", "pvNLogo"], ["nProfile", "pvNProfile"], ["edLogo", "pvELogo"], ["edProfile", "pvEProfile"]]
  .forEach(([id, pv]) => { if ($(id)) $(id).addEventListener("input", () => showPreview(pv, val(id))); });

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
  if (sites.some((s) => s.clinicId === clinicId)) return say(msg, "هذا المعرّف مستخدم بالفعل.", "err");

  say(msg, "جارٍ الإنشاء…");
  try {
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
      address: "",
      profileImage: val("nProfile"), coverImage: "", logo: val("nLogo"),
      aboutDoctor: "", qualifications: "", experience: "",
      googleMapsUrl: "",
      socialMedia: {},
      workingHours: {},
      themeSettings: { primaryColor: "#0f766e" },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await setDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"), settings, { merge: true });
    await setDoc(doc(db, "websiteDirectory", slug),
      { clinicId, slug, doctorEmail: String(email || "").toLowerCase(), updatedAt: Date.now() },
      { merge: true });

    // حساب دخول للطبيب (اختياري) — بتطبيق ثانوي حتى لا تخرج من حسابك
    let accountNote = "";
    if (email && pass) {
      try {
        const second = initializeApp(app.options, "admin-create-" + Date.now());
        const secondAuth = getAuth(second);
        const cred = await createUserWithEmailAndPassword(secondAuth, email, pass);
        await setDoc(doc(db, "users", cred.user.uid), {
          email, name, role: "doctor", clinicId, isActive: true, createdAt: Date.now()
        }, { merge: true });
        await signOut(secondAuth);
        await deleteApp(second);
        accountNote = " وتم إنشاء حساب دخول الطبيب.";
      } catch (e) {
        accountNote = " (تعذر إنشاء حساب الدخول: " + arabicError(e) + ")";
      }
    }

    say(msg, "تم إنشاء الموقع ✔" + accountNote + " الرابط: /" + slug, "ok");
    ["nName", "nSpec", "nClinicName", "nSlug", "nClinicId", "nPhone", "nWa", "nEmail", "nPass", "nLogo", "nProfile"]
      .forEach((id) => { if ($(id)) $(id).value = ""; });
    showPreview("pvNLogo", ""); showPreview("pvNProfile", "");
    loadSites();
  } catch (e) {
    say(msg, arabicError(e), "err");
  }
}

/* ================= EDIT ================= */

function openEdit(s) {
  editing = s;
  const v = s.settings || {};
  $("edTitle").textContent = "تعديل: " + (v.doctorName || s.slug);
  $("edName").value = v.doctorName || "";
  $("edTitleF").value = v.doctorTitle || "";
  $("edSpec").value = v.specialty || "";
  $("edClinicName").value = v.clinicName || "";
  $("edPhone").value = v.phone || "";
  $("edWa").value = v.whatsapp || "";
  $("edSlug").value = s.slug || "";
  $("edAddress").value = v.address || "";
  $("edLogo").value = v.logo || "";
  $("edProfile").value = v.profileImage || "";
  showPreview("pvELogo", v.logo || "");
  showPreview("pvEProfile", v.profileImage || "");
  $("edEnabled").value = (v.isWebsiteEnabled !== false) ? "1" : "0";
  say($("edMsg"), "");
  $("editOverlay").classList.remove("hidden");
}

$("edClose").addEventListener("click", () => {
  $("editOverlay").classList.add("hidden");
  editing = null;
});

$("edSave").addEventListener("click", async () => {
  if (!editing) return;
  const msg = $("edMsg");
  const oldSlug = editing.slug;
  const newSlug = slugify(val("edSlug"));
  if (!newSlug) return say(msg, "الرابط مطلوب.", "err");
  if (newSlug !== oldSlug && sites.some((s) => s.slug === newSlug)) {
    return say(msg, "هذا الرابط مستخدم بالفعل.", "err");
  }

  say(msg, "جارٍ الحفظ…");
  try {
    const patch = {
      doctorName: val("edName"),
      doctorTitle: val("edTitleF"),
      specialty: val("edSpec"),
      clinicName: val("edClinicName"),
      phone: val("edPhone"),
      whatsapp: val("edWa"),
      address: val("edAddress"),
      logo: val("edLogo"),
      profileImage: val("edProfile"),
      slug: newSlug,
      isWebsiteEnabled: val("edEnabled") === "1",
      updatedAt: Date.now()
    };
    await setDoc(doc(db, "clinics", editing.clinicId, "websiteSettings", "main"), patch, { merge: true });
    if (newSlug !== oldSlug) {
      await setDoc(doc(db, "websiteDirectory", newSlug),
        { clinicId: editing.clinicId, slug: newSlug, updatedAt: Date.now() }, { merge: true });
      if (oldSlug) { try { await deleteDoc(doc(db, "websiteDirectory", oldSlug)); } catch (e) { /* ignore */ } }
    }
    Object.assign(editing.settings, patch);
    editing.slug = newSlug;
    say(msg, "تم الحفظ ✔", "ok");
    renderStats(); renderRows();
    setTimeout(() => { $("editOverlay").classList.add("hidden"); editing = null; }, 700);
  } catch (e) {
    say(msg, arabicError(e), "err");
  }
});
