// ============ Doctor Website Engine — public website ============
// Loads one clinic's website settings from Firebase using the URL slug.
// Nothing about the doctor is hard-coded here.

import { db } from "./firebase-config.js";
import {
  doc, getDoc, onSnapshot, collection, collectionGroup, getDocs, query, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const has = (v) => v != null && String(v).trim() !== "";
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

function state(which) {
  ["stLoading", "stNotFound", "stDisabled", "stDirectory"].forEach((id) => hide($(id)));
  hide($("site"));
  if (which === "site") show($("site")); else show($(which));
}

/* ---------------- slug ---------------- */
function readSlug() {
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get("slug") || qs.get("d") || qs.get("doctor");
  if (has(fromQuery)) return fromQuery.trim().toLowerCase();

  // A trailing "/" means the last segment is a folder (e.g. the GitHub Pages
  // project base), not a doctor slug.
  if (/\/$/.test(location.pathname)) return "";
  const parts = location.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last && !/\.html?$/i.test(last)) return last.trim().toLowerCase();
  return "";
}

/* ---------------- lookup ---------------- */
// 1) websiteDirectory/{slug} -> { clinicId }   (fast public index)
// 2) collectionGroup("websiteSettings") where slug == slug
// 3) clinics/{slug}/websiteSettings/main      (slug used as clinicId)
async function resolveClinicId(slug) {
  try {
    const d = await getDoc(doc(db, "websiteDirectory", slug));
    if (d.exists() && has(d.data().clinicId)) return d.data().clinicId;
  } catch (e) { /* ignore */ }

  try {
    const snap = await getDocs(query(collectionGroup(db, "websiteSettings"), where("slug", "==", slug), limit(1)));
    if (!snap.empty) {
      // path: clinics/{clinicId}/websiteSettings/main
      return snap.docs[0].ref.parent.parent.id;
    }
  } catch (e) { /* needs a collection-group index; falls through */ }

  try {
    const d = await getDoc(doc(db, "clinics", slug, "websiteSettings", "main"));
    if (d.exists()) return slug;
  } catch (e) { /* ignore */ }

  return "";
}

/* ---------------- rendering ---------------- */
const DAYS = [
  ["saturday", "السبت"], ["sunday", "الأحد"], ["monday", "الإثنين"],
  ["tuesday", "الثلاثاء"], ["wednesday", "الأربعاء"],
  ["thursday", "الخميس"], ["friday", "الجمعة"]
];

function waLink(number, name) {
  const digits = String(number || "").replace(/\D/g, "");
  if (!digits) return "";
  const text = encodeURIComponent("مرحباً " + (name || "") + "، أرغب في حجز موعد.");
  return "https://wa.me/" + digits + "?text=" + text;
}

function renderHeader(s) {
  const logoSlot = $("brandLogo");
  logoSlot.innerHTML = has(s.logo)
    ? '<img class="brand-logo" src="' + esc(s.logo) + '" alt="" />'
    : '<span class="brand-fallback">🩺</span>';
  $("brandName").textContent = s.doctorName || s.clinicName || "العيادة";
  $("brandSpec").textContent = s.specialty || "";
  document.title = (s.doctorName || s.clinicName || "موقع الطبيب") +
    (s.specialty ? " — " + s.specialty : "");
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    meta.setAttribute("content",
      (s.doctorTitle || s.specialty || "") + " — " + (s.clinicName || "") +
      (s.address ? " — " + s.address : ""));
  }
}

function firstOpenDay(wh) {
  const row = normalizeHours(wh).find((item) => item && item.closed !== true && item.isClosed !== true);
  if (!row) return "";
  const from = row.open || row.from || "";
  const to = row.close || row.to || "";
  return [row.day || row.label || "", [from, to].filter(has).join(" - ")].filter(has).join(" · ");
}

function renderChrome(s) {
  const phone = String(s.phone || "").replace(/\s/g, "");
  if (has(s.phone)) {
    $("topPhone").href = "tel:" + phone;
    $("topPhoneText").textContent = s.phone;
    $("factContactText").textContent = s.phone;
    show($("topPhone")); show($("factContact"));
  } else { hide($("topPhone")); hide($("factContact")); }

  if (has(s.email)) {
    $("topEmail").href = "mailto:" + s.email;
    $("topEmailText").textContent = s.email;
    show($("topEmail"));
  } else hide($("topEmail"));

  if (has(s.address)) {
    $("topAddressText").textContent = s.address;
    $("factAddressText").textContent = s.address;
    show($("topAddress")); show($("factAddress"));
  } else { hide($("topAddress")); hide($("factAddress")); }

  if (has(s.experience)) $("factExperience").textContent = s.experience;
  const hours = firstOpenDay(s.workingHours);
  if (hours) { $("factHoursText").textContent = hours; show($("factHours")); }
  else hide($("factHours"));
  $("heroKicker").textContent = s.specialty ? "استشاري " + s.specialty : "رعاية طبية تثق بها";
}

function renderHero(s) {
  $("hDoctor").textContent = s.doctorName || s.clinicName || "";
  const t = $("hTitle"); t.textContent = s.doctorTitle || "";
  const sp = $("hSpec");
  sp.textContent = [s.specialty, s.subSpecialty].filter(has).join(" — ");
  $("hIntro").textContent = s.shortIntro || s.intro || "";

  const cover = $("heroCover");
  cover.style.backgroundImage = has(s.coverImage) ? 'url("' + s.coverImage + '")' : "";

  const photo = $("hPhoto");
  if (has(s.profileImage)) { photo.src = s.profileImage; photo.alt = s.doctorName || ""; show(photo); }
  else hide(photo);

  const wa = waLink(s.whatsapp, s.doctorName);
  [["hWa", wa], ["bookWa", wa], ["fabWa", wa]].forEach(([id, href]) => {
    const el = $(id);
    if (href) { el.href = href; show(el); } else hide(el);
  });

  const book = $("bookBtn");
  if (has(s.bookingUrl)) { book.href = s.bookingUrl; book.target = "_blank"; }
  else if (wa) { book.href = wa; book.target = "_blank"; }
  else if (has(s.phone)) { book.href = "tel:" + String(s.phone).replace(/\s/g, ""); }
}

function renderAbout(s) {
  const cards = [];
  if (has(s.aboutDoctor)) cards.push(["نبذة", s.aboutDoctor]);
  if (has(s.qualifications)) cards.push(["المؤهلات", s.qualifications]);
  if (has(s.experience)) cards.push(["الخبرات", s.experience]);
  const sec = $("about");
  if (!cards.length) { hide(sec); return; }
  $("aboutName").textContent = s.doctorName || "";
  $("aboutGrid").innerHTML = cards.map(([t, b]) =>
    '<div class="card"><p class="info-title">' + esc(t) + '</p><p class="info-body">' + esc(b) + "</p></div>"
  ).join("");
  show(sec);
}

function renderServices(list) {
  const sec = $("services");
  const items = (list || [])
    .filter((x) => x.isActive !== false && x.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!items.length) { hide(sec); return; }
  $("servicesGrid").innerHTML = items.map((x) => {
    const meta = [];
    if (has(x.price)) meta.push('<span class="pill">💰 ' + esc(x.price) + "</span>");
    if (has(x.duration)) meta.push('<span class="pill">⏱️ ' + esc(x.duration) + "</span>");
    return '<div class="card service">' +
      (has(x.image) ? '<img class="service-img" src="' + esc(x.image) + '" alt="" />' : "") +
      "<h3>" + esc(x.name || "") + "</h3>" +
      (has(x.description) ? "<p>" + esc(x.description) + "</p>" : "") +
      (meta.length ? '<div class="service-meta">' + meta.join("") + "</div>" : "") +
      "</div>";
  }).join("");
  show(sec);
}

function normalizeHours(wh) {
  if (!wh) return [];
  if (Array.isArray(wh)) {
    return wh.filter((r) => r && (r.day || r.label));
  }
  return DAYS.map(([key, label]) => {
    const r = wh[key] || wh[label];
    return r ? Object.assign({ day: label }, r) : null;
  }).filter(Boolean);
}

function renderHours(wh) {
  const rows = normalizeHours(wh);
  const sec = $("hours");
  if (!rows.length) { hide(sec); return; }
  $("hoursBody").innerHTML = rows.map((r) => {
    const closed = r.closed === true || r.isClosed === true;
    const times = closed
      ? '<span class="closed">مغلق</span>'
      : esc(r.open || r.from || "") + " — " + esc(r.close || r.to || "");
    return '<tr><td class="day">' + esc(r.day || r.label || "") + "</td><td>" + times + "</td></tr>";
  }).join("");
  show(sec);
}

const SOCIAL_ICONS = {
  facebook: "📘", instagram: "📸", twitter: "🐦", x: "✖️",
  youtube: "▶️", tiktok: "🎵", linkedin: "💼", telegram: "✈️", website: "🌐"
};

function renderContact(s) {
  const rows = [];
  if (has(s.clinicName)) rows.push(["🏥", esc(s.clinicName)]);
  if (has(s.address)) rows.push(["📍", esc(s.address)]);
  if (has(s.phone)) rows.push(["📞", '<a href="tel:' + esc(String(s.phone).replace(/\s/g, "")) + '">' + esc(s.phone) + "</a>"]);
  if (has(s.whatsapp)) rows.push(["💬", '<a target="_blank" rel="noopener" href="' + esc(waLink(s.whatsapp, s.doctorName)) + '">' + esc(s.whatsapp) + "</a>"]);
  if (has(s.email)) rows.push(["✉️", '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + "</a>"]);

  const sec = $("contact");
  const social = s.socialMedia || {};
  const links = Object.keys(social).filter((k) => has(social[k]));

  if (!rows.length && !links.length && !has(s.googleMapsUrl)) { hide(sec); return; }

  let html = rows.map(([i, v]) =>
    '<div class="contact-row"><span class="ico">' + i + "</span><div>" + v + "</div></div>"
  ).join("");
  if (has(s.googleMapsUrl)) {
    html += '<a class="btn btn-ghost" target="_blank" rel="noopener" href="' + esc(s.googleMapsUrl) + '">🗺️ الموقع على الخريطة</a>';
  }
  $("contactCard").innerHTML = html;

  const socialHtml = links.map((k) =>
    '<a target="_blank" rel="noopener" title="' + esc(k) + '" href="' + esc(social[k]) + '">' +
    (SOCIAL_ICONS[k.toLowerCase()] || "🔗") + "</a>"
  ).join("");
  if (links.length) { $("socialList").innerHTML = socialHtml; show($("socialCard")); }
  else hide($("socialCard"));
  $("topSocial").innerHTML = socialHtml;
  $("fSocial").innerHTML = socialHtml;
  show(sec);
}

function renderFooter(s) {
  $("fName").textContent = s.clinicName || s.doctorName || "";
  $("fAddress").textContent = s.address || "";
  const bits = [];
  if (has(s.phone)) bits.push("📞 " + s.phone);
  if (has(s.whatsapp)) bits.push("💬 " + s.whatsapp);
  if (has(s.email)) bits.push("✉️ " + s.email);
  $("fContact").innerHTML = bits.map(esc).join("<br>");
  $("fYear").textContent = new Date().getFullYear();
}

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (has(theme.primaryColor)) root.style.setProperty("--brand", theme.primaryColor);
  if (has(theme.primaryDark)) root.style.setProperty("--brand-dark", theme.primaryDark);
  if (has(theme.softColor)) root.style.setProperty("--brand-soft", theme.softColor);
}

function renderAll(settings, services) {
  const s = settings || {};
  applyTheme(s.themeSettings);
  renderHeader(s);
  renderChrome(s);
  renderHero(s);
  renderAbout(s);
  renderServices(services);
  renderHours(s.workingHours);
  renderContact(s);
  renderFooter(s);
  // hide nav links for hidden sections
  document.querySelectorAll("#nav a[data-sec]").forEach((a) => {
    const sec = $(a.dataset.sec);
    if (sec && sec.classList.contains("hidden")) hide(a); else show(a);
  });
  state("site");
}

/* ---------------- boot ---------------- */
async function showDirectory(hasSlug) {
  let items = [];
  let err = "";
  try {
    const snap = await getDocs(collection(db, "websiteDirectory"));
    items = snap.docs
      .map((d) => Object.assign({ slug: d.id }, d.data()))
      .filter((x) => x.isActive !== false && has(x.slug));
  } catch (e) { items = []; err = (e && e.message) ? e.message : String(e); }

  if (!items.length) {
    if (hasSlug) { state("stNotFound"); return; }
    const hint = $("emptyHint");
    if (hint) hint.textContent = err ? ("تعذر القراءة من السحابة: " + err) : "";
    state("stEmpty");
    return;
  }

  const box = $("dirList");
  box.innerHTML = items.map((x) =>
    '<a class="dir-item" href="?slug=' + encodeURIComponent(x.slug) + '">' +
    "<strong>" + esc(x.doctorName || x.clinicName || x.slug) + "</strong>" +
    (has(x.specialty) ? "<span>" + esc(x.specialty) + "</span>" : "") +
    "</a>"
  ).join("");
  state("stDirectory");
}

async function boot() {
  const slug = readSlug();
  if (!slug) { await showDirectory(false); return; }

  const clinicId = await resolveClinicId(slug);
  if (!clinicId) { await showDirectory(true); return; }

  let settings = null;
  let services = [];
  let ready = false;

  const paint = () => { if (ready) renderAll(settings, services); };

  // live website settings
  onSnapshot(doc(db, "clinics", clinicId, "websiteSettings", "main"), (snap) => {
    if (!snap.exists()) { state("stNotFound"); return; }
    settings = snap.data();
    if (settings.isWebsiteEnabled === false) { state("stDisabled"); return; }
    ready = true;
    paint();
  }, () => state("stNotFound"));

  // live services
  onSnapshot(collection(db, "clinics", clinicId, "services"), (snap) => {
    services = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    paint();
  }, () => { services = []; paint(); });
}

/* mobile menu */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "menuBtn") $("nav").classList.toggle("open");
  else if (e.target.closest && e.target.closest("#nav a")) $("nav").classList.remove("open");
});

boot();
