// ============ Doctor Website Engine — integrated online booking ============
// The patient books from the public website and the reservation is handed to
// the EXISTING Clinic Management app (same Firebase project).
//
// Firestore paths used (all under the clinic resolved from the URL slug):
//   websiteDirectory/{slug}                      <- { clinicId, doctorId } (admin-only write)
//   clinics/{clinicId}/publicAvailability/main   <- published by Clinic Management
//        { doctors:[{id,name}], doctorIds:[...], sched:{doctorId:{start,end,...}},
//          busy:["YYYY-MM-DD|HH:MM|doctorId"] }  (no patient names / phones — times only)
//   clinics/{clinicId}/bookedSlots/{YYYY-MM-DD_HHMM_doctorId}     <- public "slot is taken" lock
//   clinics/{clinicId}/websiteBookings/{YYYY-MM-DD_HHMM_doctorId} <- the request itself
//        (create-only for the public; Clinic Management imports it into its bookings list)
// The doctor is NOT chosen by the visitor: it comes from the website's directory entry,
// and the security rules re-check it against websiteDirectory/{slug}.
// Both docs are created in ONE batch. The security rules refuse the batch if
// the slot doc already exists, so two patients can never get the same slot.

import {
  doc, getDoc, getDocs, collection, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const has = (v) => v != null && String(v).trim() !== "";
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const toMin = (t) => { const [h, m] = String(t || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const toHHMM = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const WH_KEYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAYS_AHEAD = 14;

const MSG = {
  taken: "عذرًا، هذا الموعد لم يعد متاحًا. يرجى اختيار موعد آخر.",
  name: "من فضلك اكتب الاسم بالكامل.",
  phone: "رقم الهاتف غير صحيح. اكتب رقمًا من 8 إلى 15 رقمًا.",
  date: "من فضلك اختر تاريخ الموعد.",
  time: "من فضلك اختر وقت الموعد.",
  noSlots: "لا توجد مواعيد متاحة حاليًا. يرجى التواصل مع العيادة.",
  disabled: "الحجز من الموقع غير متاح حاليًا لهذه العيادة.",
  network: "تعذر الاتصال الآن. تحقق من الإنترنت وحاول مرة أخرى.",
  generic: "تعذر إتمام الحجز الآن. يرجى المحاولة لاحقًا أو التواصل مع العيادة."
};

let ctx = null;      // { db, clinicId, settings, slug, doctorId }
let modal = null;
let avail = null;    // { perDay, busy:Set, doctorName }
let picked = { date: "", time: "" };

export function bookingEnabled(settings, site) {
  return !!settings && settings.isWebsiteEnabled !== false && settings.onlineBookingEnabled !== false &&
    !!(site && site.slug && site.doctorId);
}

export function setupBooking(db, clinicId, settings, site) {
  ctx = { db, clinicId, settings, slug: site.slug, doctorId: site.doctorId };
  const btn = document.getElementById("bookBtn");
  if (!btn || btn.dataset.bookingBound) return;
  btn.dataset.bookingBound = "1";
  btn.addEventListener("click", (e) => {
    if (!ctx || !bookingEnabled(ctx.settings, ctx)) return; // keep the old link behaviour
    e.preventDefault();
    open();
  });
}

function doctorName() {
  const s = ctx.settings || {};
  return ((avail && avail.doctorName) || s.bookingDoctorName || s.doctorName || "").trim();
}

/* ---------------- availability (reuses Clinic Management schedule) ---------------- */
function scheduleFromWorkingHours(wh) {
  // fallback only when Clinic Management has not published its schedule yet
  const out = {};
  if (!wh || typeof wh !== "object") return out;
  Object.keys(wh).forEach((k) => {
    const r = wh[k] || {};
    const dow = WH_KEYS[String(k).toLowerCase()];
    if (dow == null || r.closed || !r.open || !r.close) return;
    out[dow] = { start: r.open, end: r.close };
  });
  return out;
}

async function loadAvailability() {
  const { db, clinicId, doctorId } = ctx;
  const [pa, locks] = await Promise.all([
    getDoc(doc(db, "clinics", clinicId, "publicAvailability", "main")).catch(() => null),
    getDocs(collection(db, "clinics", clinicId, "bookedSlots")).catch(() => null)
  ]);
  const busy = new Set();
  let perDay = null; // dow -> {start,end,breakStart,breakEnd,slotMinutes}
  let docName = "";
  if (pa && pa.exists()) {
    const d = pa.data() || {};
    const cfg = (d.sched || {})[doctorId];
    const me = (d.doctors || []).find((x) => x && x.id === doctorId);
    if (me) docName = me.name || "";
    if (cfg && (d.doctorIds || []).includes(doctorId)) {
      perDay = {};
      (cfg.days || []).map(Number).forEach((dow) => { perDay[dow] = cfg; });
    }
    (d.busy || []).forEach((b) => {
      const [date, time, did] = String(b).split("|");
      if (did === doctorId) busy.add(date + "|" + time);
    });
  }
  // only THIS doctor's locks — another doctor's 10:00 never blocks this doctor
  if (locks) locks.forEach((l) => {
    const x = l.data() || {};
    if (x.doctorId === doctorId) busy.add(x.date + "|" + x.time);
  });
  avail = { perDay, busy, doctorName: docName };
}

function slotsFor(dateStr) {
  if (!avail || !avail.perDay) return [];
  const d = new Date(dateStr + "T00:00:00");
  const cfg = avail.perDay[d.getDay()];
  if (!cfg) return [];
  const s = toMin(cfg.start), e = toMin(cfg.end), step = Number(cfg.slotMinutes) || 30;
  if (!s || !e || e <= s) return [];
  const bs = cfg.breakStart ? toMin(cfg.breakStart) : null;
  const be = cfg.breakEnd ? toMin(cfg.breakEnd) : null;
  const now = new Date();
  const isToday = dateStr === isoLocal(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (let t = s; t + step <= e; t += step) {
    if (bs !== null && be !== null && t < be && t + step > bs) continue;
    if (isToday && t <= nowMin + 15) continue;
    const hh = toHHMM(t);
    out.push({ time: hh, taken: avail.busy.has(dateStr + "|" + hh) });
  }
  return out;
}

function upcomingDates() {
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const x = new Date(d); x.setDate(d.getDate() + i);
    const iso = isoLocal(x);
    const slots = slotsFor(iso);
    if (slots.some((s) => !s.taken)) out.push({ iso, label: DAY_NAMES[x.getDay()], day: x.getDate(), month: x.getMonth() + 1 });
  }
  return out;
}

/* ---------------- UI ---------------- */
function build() {
  modal = document.createElement("div");
  modal.className = "bk-overlay hidden";
  modal.innerHTML =
    '<div class="bk-modal" role="dialog" aria-modal="true" aria-labelledby="bkTitle">' +
      '<button type="button" class="bk-close" data-bk="close" aria-label="إغلاق">×</button>' +
      '<div id="bkForm">' +
        '<p class="bk-eyebrow">حجز موعد</p>' +
        '<h3 id="bkTitle">احجز موعدك</h3>' +
        '<div class="bk-doctor" id="bkDoctor"></div>' +
        '<p class="bk-note hidden" id="bkInstr"></p>' +
        '<div id="bkBody"></div>' +
      '</div>' +
      '<div id="bkDone" class="hidden"></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t === modal || (t.closest && t.closest('[data-bk="close"]'))) close();
    const dBtn = t.closest && t.closest("[data-date]");
    if (dBtn) { picked.date = dBtn.dataset.date; picked.time = ""; renderPicker(); }
    const tBtn = t.closest && t.closest("[data-time]");
    if (tBtn && !tBtn.disabled) { picked.time = tBtn.dataset.time; renderPicker(); }
    if (t.closest && t.closest('[data-bk="submit"]')) submit();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) close(); });
}

function close() { modal.classList.add("hidden"); document.body.style.overflow = ""; }

async function open() {
  if (!modal) build();
  const s = ctx.settings || {};
  picked = { date: "", time: "" };
  document.getElementById("bkForm").classList.remove("hidden");
  document.getElementById("bkDone").classList.add("hidden");
  document.getElementById("bkDoctor").innerHTML =
    "<strong>" + esc(s.doctorName || "") + "</strong>" +
    [s.specialty, s.clinicName].filter(has).map((x) => "<span>" + esc(x) + "</span>").join("");
  const instr = document.getElementById("bkInstr");
  if (has(s.bookingInstructions)) { instr.textContent = s.bookingInstructions; instr.classList.remove("hidden"); }
  else instr.classList.add("hidden");
  document.getElementById("bkBody").innerHTML = '<p class="bk-muted">جارٍ تحميل المواعيد المتاحة…</p>';
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  try { await loadAvailability(); }
  catch (e) { document.getElementById("bkBody").innerHTML = '<p class="bk-err">' + MSG.network + "</p>"; return; }
  renderBody();
}

function renderBody() {
  const dates = upcomingDates();
  const body = document.getElementById("bkBody");
  if (!dates.length) { body.innerHTML = '<p class="bk-err">' + MSG.noSlots + "</p>"; return; }
  body.innerHTML =
    '<div class="bk-grid">' +
      '<div><label class="bk-label" for="bkName">الاسم</label><input id="bkName" type="text" maxlength="80" autocomplete="name" placeholder="الاسم بالكامل" /></div>' +
      '<div><label class="bk-label" for="bkPhone">رقم الهاتف</label><input id="bkPhone" type="tel" maxlength="16" autocomplete="tel" inputmode="tel" placeholder="01xxxxxxxxx" dir="ltr" /></div>' +
    "</div>" +
    '<p class="bk-label">التاريخ</p><div class="bk-dates" id="bkDates"></div>' +
    '<p class="bk-label">الوقت</p><div class="bk-times" id="bkTimes"><p class="bk-muted">اختر التاريخ أولًا.</p></div>' +
    '<label class="bk-label" for="bkNotes">سبب الزيارة (اختياري)</label>' +
    '<textarea id="bkNotes" rows="2" maxlength="300" placeholder="مثال: كشف جديد، متابعة…"></textarea>' +
    '<p class="bk-err hidden" id="bkErr"></p>' +
    '<button type="button" class="btn btn-primary bk-submit" data-bk="submit">تأكيد الحجز</button>';
  renderPicker(dates);
}

function renderPicker(dates) {
  dates = dates || upcomingDates();
  document.getElementById("bkDates").innerHTML = dates.map((d) =>
    '<button type="button" class="bk-chip' + (picked.date === d.iso ? " on" : "") + '" data-date="' + d.iso + '">' +
    "<small>" + d.label + "</small><b>" + d.day + "/" + d.month + "</b></button>").join("");
  const tbox = document.getElementById("bkTimes");
  if (!picked.date) return;
  const slots = slotsFor(picked.date);
  tbox.innerHTML = slots.length ? slots.map((s) =>
    '<button type="button" class="bk-slot' + (s.taken ? " taken" : "") + (picked.time === s.time ? " on" : "") +
    '" data-time="' + s.time + '"' + (s.taken ? " disabled" : "") + ">" + s.time + "</button>").join("")
    : '<p class="bk-muted">لا توجد مواعيد في هذا اليوم.</p>';
}

function showErr(m) { const el = document.getElementById("bkErr"); el.textContent = m; el.classList.remove("hidden"); }

function makeRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  const buf = new Uint32Array(6); crypto.getRandomValues(buf);
  buf.forEach((n) => { r += chars[n % chars.length]; });
  return r;
}

async function submit() {
  const s = ctx.settings || {};
  if (!bookingEnabled(s, ctx)) return showErr(MSG.disabled);
  const name = document.getElementById("bkName").value.trim().replace(/\s+/g, " ");
  const phone = document.getElementById("bkPhone").value.replace(/[^\d+]/g, "");
  const notes = document.getElementById("bkNotes").value.trim().slice(0, 300);
  if (name.length < 3) return showErr(MSG.name);
  if (!/^\+?\d{8,15}$/.test(phone)) return showErr(MSG.phone);
  if (!picked.date) return showErr(MSG.date);
  if (!picked.time) return showErr(MSG.time);
  const valid = slotsFor(picked.date).find((x) => x.time === picked.time && !x.taken);
  if (!valid) return showErr(MSG.taken);

  const btn = document.querySelector('[data-bk="submit"]');
  btn.disabled = true; btn.textContent = "جارٍ الحجز…";
  const { db, clinicId, slug, doctorId } = ctx;
  const slotId = picked.date + "_" + picked.time.replace(":", "") + "_" + doctorId;
  const ref = makeRef();
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "clinics", clinicId, "websiteBookings", slotId), {
      ref, fullName: name, phone, notes,
      date: picked.date, time: picked.time,
      doctor: doctorName().slice(0, 120), doctorId, slug, clinicId,
      source: "website", status: "مجدول", imported: false,
      createdAt: Date.now()
    });
    batch.set(doc(db, "clinics", clinicId, "bookedSlots", slotId), {
      date: picked.date, time: picked.time, doctorId, createdAt: Date.now()
    });
    await batch.commit();
    done({ name, ref, date: picked.date, time: picked.time });
  } catch (e) {
    btn.disabled = false; btn.textContent = "تأكيد الحجز";
    const code = (e && e.code) || "";
    if (code === "permission-denied") {
      // most likely: someone booked this slot a moment ago (or booking was disabled)
      let taken = false;
      try { taken = (await getDoc(doc(db, "clinics", clinicId, "bookedSlots", slotId))).exists(); } catch {}
      if (taken) { avail.busy.add(picked.date + "|" + picked.time); picked.time = ""; renderPicker(); return showErr(MSG.taken); }
      return showErr(MSG.disabled);
    }
    if (code === "unavailable" || code === "deadline-exceeded" || !navigator.onLine) return showErr(MSG.network);
    showErr(MSG.generic);
  }
}

function done(b) {
  const s = ctx.settings || {};
  const d = new Date(b.date + "T00:00:00");
  document.getElementById("bkForm").classList.add("hidden");
  const box = document.getElementById("bkDone");
  box.innerHTML =
    '<div class="bk-ok">✓</div>' +
    '<h3>تم حجز موعدك بنجاح</h3>' +
    '<dl class="bk-summary">' +
      "<dt>الطبيب</dt><dd>" + esc(s.doctorName || "") + "</dd>" +
      (has(s.clinicName) ? "<dt>العيادة</dt><dd>" + esc(s.clinicName) + "</dd>" : "") +
      "<dt>التاريخ</dt><dd>" + DAY_NAMES[d.getDay()] + " " + esc(b.date) + "</dd>" +
      "<dt>الوقت</dt><dd>" + esc(b.time) + "</dd>" +
      "<dt>اسم المريض</dt><dd>" + esc(b.name) + "</dd>" +
      "<dt>رقم الحجز</dt><dd><b dir=\"ltr\">" + esc(b.ref) + "</b></dd>" +
    "</dl>" +
    '<p class="bk-muted">احتفظ برقم الحجز. ستتواصل معك العيادة عند الحاجة.</p>' +
    '<button type="button" class="btn btn-primary bk-submit" data-bk="close">العودة للموقع</button>';
  box.classList.remove("hidden");
}
