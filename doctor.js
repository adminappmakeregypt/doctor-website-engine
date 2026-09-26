// ============ Doctor Website Engine — doctor dashboard ============
// الطبيب يعدّل بيانات موقعه: النبذة، الصور، الخدمات، المواعيد والتواصل.
// نفس Firebase ونفس بنية البيانات المستخدمة في الموقع العام ولوحة المدير.

import { auth, db, storage } from "./firebase-config.js?v=25";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const val = (id) => ($(id) ? String($(id).value || "").trim() : "");
const setVal = (id, v) => { if ($(id)) $(id).value = v == null ? "" : v; };

function say(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

function arabicError(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "بيانات الدخول غير صحيحة.";
  if (c.includes("too-many-requests")) return "محاولات كثيرة، حاول بعد قليل.";
  if (c.includes("permission-denied") || c.includes("unauthorized"))
    return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  if (c.includes("network")) return "تعذر الاتصال بالإنترنت.";
  return (e && e.message) ? e.message : "حدث خطأ غير متوقع.";
}

const DAYS = [
  ["saturday", "السبت"], ["sunday", "الأحد"], ["monday", "الإثنين"],
  ["tuesday", "الثلاثاء"], ["wednesday", "الأربعاء"], ["thursday", "الخميس"],
  ["friday", "الجمعة"]
];

/* ---------- state ---------- */
let clinicId = "";
let settings = {};
let services = [];
const authReady = setPersistence(auth, browserLocalPersistence);

/* ================= AUTH ================= */
$("liBtn").addEventListener("click", doLogin);
$("liPass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("liEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

async function doLogin() {
  say($("liMsg"), "جارٍ الدخول…");
  try {
    await authReady;
    await signInWithEmailAndPassword(auth, val("liEmail"), $("liPass").value);
    say($("liMsg"), "");
  } catch (e) { say($("liMsg"), arabicError(e), "err"); }
}

$("liForgot").addEventListener("click", async () => {
  const email = val("liEmail");
  if (!email) { say($("liMsg"), "اكتب بريدك الإلكتروني أولاً.", "err"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    say($("liMsg"), "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك ✔", "ok");
  } catch (e) { say($("liMsg"), arabicError(e), "err"); }
});

$("outBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clinicId = "";
    $("panel").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    return;
  }
  $("whoEmail").textContent = user.email || "";
  $("loginScreen").classList.add("hidden");
  $("panel").classList.remove("hidden");
  await boot(user);
});

/* ---------- find the clinic linked to this account ---------- */
const DOCTOR_ROLES = ["doctor", "admin", "superadmin", "super_admin", "owner"];
let accessError = "";

async function resolveClinicId(user) {
  accessError = "";
  let profile = null;
  try {
    const d = await getDoc(doc(db, "users", user.uid));
    if (d.exists()) profile = d.data() || {};
  } catch (e) { /* rules may block */ }
  if (profile) {
    if (profile.isActive === false) { accessError = "تم إيقاف هذا الحساب. تواصل مع الإدارة."; return ""; }
    const role = String(profile.role || "").toLowerCase();
    if (role && !DOCTOR_ROLES.includes(role)) { accessError = "هذا الحساب ليس حساب طبيب."; return ""; }
  }
  // v25: primary ownership = Firebase UID stored on the directory entry
  try {
    const snap = await getDocs(query(collection(db, "websiteDirectory"), where("ownerUid", "==", user.uid), limit(1)));
    if (!snap.empty) return String(snap.docs[0].data().clinicId || "");
  } catch (e) { /* ignore */ }
  if (profile && profile.clinicId) return String(profile.clinicId);
  // legacy fallback (old sites not migrated yet): directory entry that carries the doctor's email
  try {
    const snap = await getDocs(query(
      collection(db, "websiteDirectory"),
      where("doctorEmail", "==", String(user.email || "").toLowerCase()),
      limit(1)
    ));
    if (!snap.empty) return String(snap.docs[0].data().clinicId || "");
  } catch (e) { /* ignore */ }
  return "";
}

async function boot(user) {
  clinicId = await resolveClinicId(user);
  if (!clinicId) {
    const p = $("noClinic").querySelector("p");
    if (p) p.textContent = accessError || "لا يوجد موقع مرتبط بحسابك بعد. تواصل مع الإدارة لربط حسابك بالعيادة.";
    $("noClinic").classList.remove("hidden");
    $("editor").classList.add("hidden");
    return;
  }
  $("noClinic").classList.add("hidden");
  $("editor").classList.remove("hidden");
  await loadAll();
}

async function loadAll() {
  settings = {};
  try {
    const d = await getDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"));
    if (d.exists()) settings = d.data() || {};
  } catch (e) { say($("saveMsg"), arabicError(e), "err"); }
  fillForm(settings);
  await loadServices();
}

/* ================= FORM ================= */
function fillForm(s) {
  setVal("fDoctorName", s.doctorName);
  setVal("fDoctorTitle", s.doctorTitle);
  setVal("fSpecialty", s.specialty);
  setVal("fSubSpecialty", s.subSpecialty);
  setVal("fClinicName", s.clinicName);
  setVal("fSlug", s.slug);
  setVal("fProfileImage", s.profileImage);
  setVal("fCoverImage", s.coverImage);
  setVal("fLogo", s.logo);
  setVal("fShortIntro", s.shortIntro);
  setVal("fAboutDoctor", s.aboutDoctor);
  setVal("fQualifications", s.qualifications);
  setVal("fExperience", s.experience);
  setVal("fPhone", s.phone);
  setVal("fWhatsapp", s.whatsapp);
  setVal("fEmail", s.email);
  setVal("fAddress", s.address);
  setVal("fGoogleMapsUrl", s.googleMapsUrl);
  setVal("fBookingUrl", s.bookingUrl);
  setVal("fReviews", (Array.isArray(s.reviews) ? s.reviews : [])
    .map((r) => (r.name || "") + " | " + (r.text || r.comment || "")).join("\n"));

  const so = s.socialMedia || {};
  setVal("soFacebook", so.facebook);
  setVal("soInstagram", so.instagram);
  setVal("soTwitter", so.twitter || so.x);
  setVal("soYoutube", so.youtube);
  setVal("soTiktok", so.tiktok);
  setVal("soLinkedin", so.linkedin);

  const theme = s.themeSettings || {};
  if (theme.primaryColor && /^#[0-9a-fA-F]{6}$/.test(theme.primaryColor)) {
    setVal("fPrimaryColor", theme.primaryColor);
  }
  $("fEnabled").checked = s.isWebsiteEnabled !== false;
  $("fOnlineBooking").checked = s.onlineBookingEnabled !== false;
  setVal("fBookingInstructions", s.bookingInstructions);

  ["Profile", "Cover", "Logo"].forEach(preview);
  renderHours(s.workingHours);

  const link = s.slug ? ("index.html?slug=" + encodeURIComponent(s.slug)) : "index.html";
  $("viewSite").href = link;
}

function preview(kind) {
  const url = kind === "Logo" ? val("fLogo") : val("f" + kind + "Image");
  const img = $("pv" + kind);
  if (!img) return;
  if (url) { img.src = url; img.classList.add("show"); }
  else { img.removeAttribute("src"); img.classList.remove("show"); }
}
["Profile", "Cover"].forEach((k) => {
  $("f" + k + "Image").addEventListener("input", () => preview(k));
});
$("fLogo").addEventListener("input", () => preview("Logo"));

/* ---------- image uploads (نفس تخزين Firebase الحالي) ---------- */
function wireUpload(inputId, targetId, folder, previewId) {
  $(inputId).addEventListener("change", async () => {
    const file = $(inputId).files && $(inputId).files[0];
    if (!file) return;
    say($("upMsg"), "جارٍ رفع الصورة…");
    try {
      const path = "clinics/" + clinicId + "/attachments/website/" + folder + "/" + Date.now() + "_" + file.name.replace(/[^\w.\-]+/g, "_");
      const r = ref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setVal(targetId, url);
      const img = $(previewId);
      img.src = url; img.classList.add("show");
      say($("upMsg"), "تم رفع الصورة ✔ لا تنسَ الحفظ.", "ok");
    } catch (e) { say($("upMsg"), arabicError(e), "err"); }
  });
}
wireUpload("upProfile", "fProfileImage", "profile", "pvProfile");
wireUpload("upCover", "fCoverImage", "cover", "pvCover");
wireUpload("upLogo", "fLogo", "logo", "pvLogo");

/* ---------- working hours ---------- */
function renderHours(wh) {
  const cur = {};
  if (wh && !Array.isArray(wh)) Object.assign(cur, wh);
  if (Array.isArray(wh)) {
    wh.forEach((r) => {
      const hit = DAYS.find(([k, label]) => r.day === label || r.day === k || r.label === label);
      if (hit) cur[hit[0]] = r;
    });
  }
  $("hoursRows").innerHTML = DAYS.map(([key, label]) => {
    const r = cur[key] || {};
    const closed = r.closed === true || r.isClosed === true;
    return '<tr data-day="' + key + '">' +
      "<td>" + esc(label) + "</td>" +
      '<td><input type="time" class="h-open" value="' + esc(r.open || r.from || "") + '" /></td>' +
      '<td><input type="time" class="h-close" value="' + esc(r.close || r.to || "") + '" /></td>' +
      '<td><input type="checkbox" class="h-closed"' + (closed ? " checked" : "") + " /></td>" +
      "</tr>";
  }).join("");
}

function collectHours() {
  const out = {};
  $("hoursRows").querySelectorAll("tr").forEach((tr) => {
    const key = tr.dataset.day;
    const open = tr.querySelector(".h-open").value;
    const close = tr.querySelector(".h-close").value;
    const closed = tr.querySelector(".h-closed").checked;
    if (!closed && !open && !close) return; // يوم فارغ لا يُحفظ
    out[key] = { open: open, close: close, closed: closed };
  });
  return out;
}

/* ================= SAVE SETTINGS ================= */
$("saveBtn").addEventListener("click", async () => {
  if (!clinicId) return;
  say($("saveMsg"), "جارٍ الحفظ…");
  const patch = {
    doctorName: val("fDoctorName"),
    doctorTitle: val("fDoctorTitle"),
    specialty: val("fSpecialty"),
    subSpecialty: val("fSubSpecialty"),
    clinicName: val("fClinicName"),
    profileImage: val("fProfileImage"),
    coverImage: val("fCoverImage"),
    logo: val("fLogo"),
    shortIntro: val("fShortIntro"),
    aboutDoctor: val("fAboutDoctor"),
    qualifications: val("fQualifications"),
    experience: val("fExperience"),
    phone: val("fPhone"),
    whatsapp: val("fWhatsapp"),
    email: val("fEmail"),
    address: val("fAddress"),
    googleMapsUrl: val("fGoogleMapsUrl"),
    bookingUrl: val("fBookingUrl"),
    reviews: val("fReviews").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30).map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? { name: "", text: l.slice(0, 500) }
                   : { name: l.slice(0, i).trim().slice(0, 80), text: l.slice(i + 1).trim().slice(0, 500) };
    }).filter((r) => r.text),
    socialMedia: {
      facebook: val("soFacebook"),
      instagram: val("soInstagram"),
      twitter: val("soTwitter"),
      youtube: val("soYoutube"),
      tiktok: val("soTiktok"),
      linkedin: val("soLinkedin")
    },
    themeSettings: Object.assign({}, settings.themeSettings || {}, { primaryColor: val("fPrimaryColor") }),
    workingHours: collectHours(),
    // v28: tell the clinic program the doctor changed the hours on the website
    ...(JSON.stringify(collectHours()) !== JSON.stringify(settings.workingHours || {})
      ? { hoursSource: "website", hoursUpdatedAt: Date.now() } : {}),
    isWebsiteEnabled: $("fEnabled").checked,
    onlineBookingEnabled: $("fOnlineBooking").checked,
    bookingInstructions: val("fBookingInstructions").slice(0, 300),
    updatedAt: Date.now()
  };
  try {
    await setDoc(doc(db, "clinics", clinicId, "websiteSettings", "main"), patch, { merge: true });
    settings = Object.assign({}, settings, patch);
    say($("saveMsg"), "تم حفظ التغييرات ✔ الموقع يتحدث فوراً.", "ok");
  } catch (e) { say($("saveMsg"), arabicError(e), "err"); }
});

/* ================= SERVICES ================= */
async function loadServices() {
  services = [];
  try {
    const snap = await getDocs(collection(db, "clinics", clinicId, "services"));
    services = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  } catch (e) { say($("svMsg"), arabicError(e), "err"); }
  services.sort((a, b) => (a.order || 0) - (b.order || 0));
  renderServices();
}

function renderServices() {
  const body = $("svRows");
  if (!services.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">لا توجد خدمات بعد.</td></tr>';
    return;
  }
  body.innerHTML = services.map((s) => {
    const on = s.isActive !== false;
    return "<tr>" +
      "<td><b>" + esc(s.name || "") + "</b></td>" +
      "<td>" + esc(s.description || "—") + "</td>" +
      "<td>" + esc(s.price || "—") + "</td>" +
      "<td>" + esc(s.duration || "—") + "</td>" +
      '<td><span class="badge ' + (on ? "on" : "off") + '">' + (on ? "ظاهرة" : "مخفية") + "</span></td>" +
      '<td class="row-acts">' +
        '<button class="btn btn-sm" data-act="toggle" data-id="' + esc(s.id) + '">' + (on ? "إخفاء" : "إظهار") + "</button>" +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + esc(s.id) + '">🗑️ حذف</button>' +
      "</td></tr>";
  }).join("");
}

$("svRows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const s = services.find((x) => x.id === id);
  if (!s) return;
  try {
    if (btn.dataset.act === "toggle") {
      const on = s.isActive !== false;
      await updateDoc(doc(db, "clinics", clinicId, "services", id), { isActive: !on, updatedAt: Date.now() });
      s.isActive = !on;
      renderServices();
      say($("svMsg"), "تم تحديث الخدمة ✔", "ok");
    } else if (btn.dataset.act === "del") {
      if (!confirm("حذف الخدمة «" + (s.name || "") + "»؟")) return;
      await deleteDoc(doc(db, "clinics", clinicId, "services", id));
      services = services.filter((x) => x.id !== id);
      renderServices();
      say($("svMsg"), "تم حذف الخدمة ✔", "ok");
    }
  } catch (err) { say($("svMsg"), arabicError(err), "err"); }
});

$("svAdd").addEventListener("click", async () => {
  const name = val("svName");
  if (!name) { say($("svMsg"), "اكتب اسم الخدمة أولاً.", "err"); return; }
  say($("svMsg"), "جارٍ الإضافة…");
  const data = {
    name: name,
    description: val("svDesc"),
    price: val("svPrice"),
    duration: val("svDuration"),
    isActive: true,
    order: services.length + 1,
    createdAt: Date.now()
  };
  try {
    const r = await addDoc(collection(db, "clinics", clinicId, "services"), data);
    services.push(Object.assign({ id: r.id }, data));
    renderServices();
    ["svName", "svDesc", "svPrice", "svDuration"].forEach((id) => setVal(id, ""));
    say($("svMsg"), "تمت إضافة الخدمة ✔", "ok");
  } catch (e) { say($("svMsg"), arabicError(e), "err"); }
});

/* ================= TABS ================= */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.add("hidden"));
    const pane = $(btn.dataset.tab);
    if (pane) pane.classList.remove("hidden");
  });
});

/* جدول المواعيد يظهر فارغاً قبل تحميل البيانات */
renderHours({});
