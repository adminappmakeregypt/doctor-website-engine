// ============ Doctor Website Engine — public website ============
// Loads one clinic's website settings from Firebase using the URL slug.
// Nothing about the doctor is hard-coded here.

import { db } from "./firebase-config.js";
import { setupBooking, bookingEnabled } from "./booking.js?v=3";
let CURRENT_CLINIC = "";
let CURRENT_SITE = { slug: "", doctorId: "" }; // from websiteDirectory (admin-controlled)
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
    if (d.exists() && has(d.data().clinicId)) {
      CURRENT_SITE = { slug, doctorId: d.data().doctorId || "" };
      return d.data().clinicId;
    }
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

const SPECIALTY_ICONS = [
  [/(قلب|cardio)/i, "\u2665"],
  [/(أسنان|اسنان|dent)/i, "\u2698"],
  [/(عيون|عين|ophthal|eye)/i, "\u25C9"],
  [/(أطفال|اطفال|pediat)/i, "\u273F"],
  [/(جلد|derma)/i, "\u2741"],
  [/(عظام|ortho)/i, "\u271A"],
  [/(نساء|توليد|gyne)/i, "\u273F"],
  [/(مخ|أعصاب|اعصاب|neuro)/i, "\u2726"],
  [/(أنف|انف|أذن|اذن|ent)/i, "\u266A"],
  [/(باطن|internal)/i, "\u2695"]
];
function specialtyIcon(spec) {
  const text = String(spec || "");
  const hit = SPECIALTY_ICONS.find(([re]) => re.test(text));
  return hit ? hit[1] : "\u271A";
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
  const specText = [s.specialty, s.subSpecialty].filter(has).join(" — ");
  $("factSpecialtyText").textContent = specText || "رعاية طبية شاملة";
  const badge = $("heroBadge");
  const years = String(s.experience || "").match(/\d+/);
  if (years) {
    $("heroBadgeValue").textContent = "+" + years[0];
    $("heroBadgeLabel").textContent = "سنوات خبرة";
    show(badge);
  } else hide(badge);
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
  if (has(s.coverImage)) cover.style.backgroundImage = 'url("' + s.coverImage + '")';
  else cover.style.removeProperty("background-image");

  const photo = $("hPhoto");
  if (has(s.profileImage)) { photo.src = s.profileImage; photo.alt = s.doctorName || ""; show(photo); }
  else hide(photo);

  const wa = waLink(s.whatsapp, s.doctorName);
  [["hWa", wa], ["bookWa", wa], ["fabWa", wa]].forEach(([id, href]) => {
    const el = $(id);
    if (href) { el.href = href; show(el); } else hide(el);
  });

  const book = $("bookBtn");
  book.removeAttribute("target");
  if (bookingEnabled(s, CURRENT_SITE)) { book.href = "#book"; setupBooking(db, CURRENT_CLINIC, s, CURRENT_SITE); }
  else if (has(s.bookingUrl)) { book.href = s.bookingUrl; book.target = "_blank"; }
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
  $("aboutName").textContent = s.doctorName || s.clinicName || "عن الطبيب";
  $("aboutSpec").textContent = [s.specialty, s.doctorTitle].filter(has).join(" — ");
  $("aboutGrid").innerHTML = cards.map(([t, b]) =>
    '<div class="card"><p class="info-title">' + esc(t) + '</p><p class="info-body">' + esc(b) + "</p></div>"
  ).join("");
  show(sec);
}

let currentIcon = "\u2695";

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
      (has(x.image)
        ? '<img class="service-img" src="' + esc(x.image) + '" alt="" />'
        : '<div class="service-ico">' + (has(x.icon) ? esc(x.icon) : currentIcon) + "</div>") +
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
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.7c0-.9.3-1.6 1.6-1.6h1.7V4.2c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.4V14h2.7v8h3.4z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
  twitter: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.3l-4.9-6.4L5 21H1.9l7.3-8.3L2.2 3h6.4l4.4 5.9L17.5 3zm-1.1 16.1h1.7L7.7 4.8H5.9l10.5 14.3z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.3l-4.9-6.4L5 21H1.9l7.3-8.3L2.2 3h6.4l4.4 5.9L17.5 3zm-1.1 16.1h1.7L7.7 4.8H5.9l10.5 14.3z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8 1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.4 2 1.7 3.4 3.9 3.6v3c-1.5 0-2.8-.5-3.9-1.3v5.9c0 3.9-2.6 6.3-6 6.3-3.2 0-5.7-2.3-5.7-5.6 0-3.4 2.7-5.7 6.2-5.5v3.1c-1.7-.3-3.1.8-3.1 2.4 0 1.4 1.1 2.5 2.6 2.5 1.7 0 2.9-1.2 2.9-3.2V3h3.1z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 8.8H3.6V21h2.9V8.8zM5 7.4a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM21 13.9c0-3.2-1.7-5.3-4.4-5.3-1.7 0-2.6.9-3.1 1.6V8.8h-2.9V21h2.9v-6.6c0-1.5.6-2.5 2-2.5 1.3 0 1.9.9 1.9 2.5V21H21v-7.1z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.6 18.8 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-.9.5l.3-4.6L18 6.9c.4-.3-.1-.5-.6-.2L7.2 13.2l-4.4-1.4c-1-.3-1-1 .2-1.4L20.3 3.4c.8-.3 1.5.2 1.6 1.2z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.4 12.6c-.2.5-1.1 1-1.5 1-.4.1-.9.1-1.4-.1-.3-.1-.7-.2-1.3-.3-2.2-.9-3.6-3.1-3.7-3.3-.1-.1-.9-1.2-.9-2.2s.6-1.6.8-1.8c.2-.2.4-.3.6-.3h.4c.1 0 .3 0 .5.4l.7 1.6c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l1.6.8c.3.1.5.2.5.3.1.2.1.7-.1 1.1z"/></svg>',
  website: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z"/></svg>'
};

function renderReviews(s) {
  const sec = $("reviews");
  const list = []
    .concat(Array.isArray(s.testimonials) ? s.testimonials : [])
    .concat(Array.isArray(s.reviews) ? s.reviews : [])
    .filter((r) => r && (has(r.text) || has(r.comment) || has(r.review)));
  if (!list.length) { hide(sec); return; }
  $("reviewsGrid").innerHTML = list.map((r) => {
    const name = r.name || r.patientName || "مريض";
    const text = r.text || r.comment || r.review || "";
    const rating = Math.max(1, Math.min(5, Number(r.rating || r.stars || 5)));
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    const avatar = has(r.photo || r.avatar || r.image)
      ? '<img class="review-avatar" src="' + esc(r.photo || r.avatar || r.image) + '" alt="" />'
      : '<span class="review-avatar">' + esc(String(name).trim().charAt(0)) + "</span>";
    return '<div class="card review">' +
      '<div class="stars" aria-hidden="true">' + stars + "</div>" +
      "<p>" + esc(text) + "</p>" +
      '<div class="review-who">' + avatar +
      "<div><strong>" + esc(name) + "</strong>" +
      (has(r.date) ? "<span>" + esc(r.date) + "</span>" : "") +
      "</div></div></div>";
  }).join("");
  show(sec);
}


const UI_ICONS = {
  clinic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V8.5L12 3l8 5.5V21"/><path d="M9 21v-5h6v5"/><path d="M12 8v4M10 10h4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16.9v2.4a1.7 1.7 0 0 1-1.9 1.7 17 17 0 0 1-7.4-2.7 16.7 16.7 0 0 1-5.1-5.1A17 17 0 0 1 3.9 5.8 1.7 1.7 0 0 1 5.6 3.9H8a1.7 1.7 0 0 1 1.7 1.5c.1.9.3 1.7.6 2.5a1.7 1.7 0 0 1-.4 1.8l-1 1a13.7 13.7 0 0 0 5 5l1-1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.5.6A1.7 1.7 0 0 1 21 16.9z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6z"/><path d="M9 4v14M15 6v14"/></svg>'
};

function renderContact(s) {
  const rows = [];
  if (has(s.clinicName)) rows.push([UI_ICONS.clinic, esc(s.clinicName)]);
  if (has(s.address)) rows.push([UI_ICONS.pin, esc(s.address)]);
  if (has(s.phone)) rows.push([UI_ICONS.phone, '<a href="tel:' + esc(String(s.phone).replace(/\s/g, "")) + '">' + esc(s.phone) + "</a>"]);
  if (has(s.whatsapp)) rows.push([SOCIAL_ICONS.whatsapp, '<a target="_blank" rel="noopener" href="' + esc(waLink(s.whatsapp, s.doctorName)) + '">' + esc(s.whatsapp) + "</a>"]);
  if (has(s.email)) rows.push([UI_ICONS.mail, '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + "</a>"]);

  const sec = $("contact");
  const social = s.socialMedia || {};
  const links = Object.keys(social).filter((k) => has(social[k]));

  if (!rows.length && !links.length && !has(s.googleMapsUrl)) { hide(sec); return; }

  let html = rows.map(([i, v]) =>
    '<div class="contact-row"><span class="ico">' + i + "</span><div>" + v + "</div></div>"
  ).join("");
  if (has(s.googleMapsUrl)) {
    html += '<a class="btn btn-ghost" target="_blank" rel="noopener" href="' + esc(s.googleMapsUrl) + '">' + UI_ICONS.map + ' الموقع على الخريطة</a>';
  }
  $("contactCard").innerHTML = html;

  const socialHtml = links.map((k) =>
    '<a target="_blank" rel="noopener" title="' + esc(k) + '" href="' + esc(social[k]) + '">' +
    (SOCIAL_ICONS[k.toLowerCase()] || "🔗") + "</a>"
  ).join("");
  const grid = $("socialCard").parentElement;
  if (links.length) { $("socialList").innerHTML = socialHtml; show($("socialCard")); grid.classList.remove("grid-1"); }
  else { hide($("socialCard")); grid.classList.add("grid-1"); }
  $("topSocial").innerHTML = socialHtml;
  $("fSocial").innerHTML = socialHtml;
  show(sec);
}

function renderFooter(s) {
  $("fLogo").innerHTML = has(s.logo) ? '<img src="' + esc(s.logo) + '" alt="" />' : "";
  $("fSpec").textContent = s.specialty || "";
  $("fName").textContent = s.clinicName || s.doctorName || "";
  $("fAddress").textContent = s.address || "";
  const bits = [];
  if (has(s.phone)) bits.push(s.phone);
  if (has(s.whatsapp)) bits.push(s.whatsapp);
  if (has(s.email)) bits.push(s.email);
  $("fContact").innerHTML = bits.map((b) => "<div>" + esc(b) + "</div>").join("");
  $("fYear").textContent = new Date().getFullYear();
}

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (has(theme.primaryColor)) root.style.setProperty("--brand", theme.primaryColor);
  if (has(theme.primaryDark)) root.style.setProperty("--brand-dark", theme.primaryDark);
  if (has(theme.softColor)) root.style.setProperty("--brand-soft", theme.softColor);
  if (has(theme.accentColor)) root.style.setProperty("--accent", theme.accentColor);
}

function renderAll(settings, services) {
  const s = settings || {};
  applyTheme(s.themeSettings);
  renderHeader(s);
  renderChrome(s);
  renderHero(s);
  renderAbout(s);
  currentIcon = specialtyIcon([s.specialty, s.subSpecialty].filter(has).join(" "));
  renderServices(services);
  renderReviews(s);
  renderHours(s.workingHours);
  renderContact(s);
  renderFooter(s);
  // hide nav links for hidden sections
  document.querySelectorAll("#nav a[data-sec], #footerNav a[data-sec]").forEach((a) => {
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
  CURRENT_CLINIC = clinicId;

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
  if (e.target && e.target.closest && e.target.closest("#menuBtn")) $("nav").classList.toggle("open");
  else if (e.target.closest && e.target.closest("#nav a")) $("nav").classList.remove("open");
});

boot();
