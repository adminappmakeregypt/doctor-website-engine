# v21 — Security & multi-doctor correction report

Rules were tested locally in the official Firebase emulator: 25/25 checks passed (tests A–J plus extras).

## 1. Slot ID format
`YYYY-MM-DD_HHMM_{doctorId}` — e.g. `2026-10-04_1000_doc1x9k2p`.
Same ID is used for `websiteBookings/{slotId}` and `bookedSlots/{slotId}`.

## 2. Doctor identification
- Clinic app doctors (`clinic_doctors_v1`) had no ID, only a name. v21 gives each doctor a permanent `id`
  (`doc` + hash of the name at creation time, stored on the record; renaming later keeps the ID).
  Existing doctors get their ID automatically the first time the clinic app is opened.
- The website resolves `slug → websiteDirectory/{slug} → { clinicId, doctorId }`.
  The platform admin picks the doctor for each site in admin.html (new "الطبيب في تطبيق العيادة" list).
- The visitor never chooses the doctor. The rules re-read `websiteDirectory/{slug}` and require
  `clinicId` and `doctorId` to match it.

## 3. Clinic ownership (enforced by Firestore Rules)
`request.auth.uid → users/{uid}.clinicId` (primary), or
`request.auth.token.email → clinicMembers/{email}.clinicId` (bridge for the existing clinic accounts
listed in auth.js — those accounts have no users/{uid} document).
Both documents can be written only by the platform admin. A user cannot create his own profile or change
his own `clinicId`, `role`, `isActive`.

## 4. Collections used by online booking
- `websiteDirectory/{slug}` — clinicId, doctorId (public read, admin write)
- `clinics/{c}/websiteSettings/main` — website on/off, booking on/off (public read)
- `clinics/{c}/publicAvailability/main` — `doctorIds`, `sched{doctorId}`, `doctors[{id,name}]`, `busy["date|time|doctorId"]`
- `clinics/{c}/websiteBookings/{slotId}` — the request (public create only)
- `clinics/{c}/bookedSlots/{slotId}` — the lock (public create only, with its booking)
- Imported into the existing `clinics/{c}/appData/clinic_bookings_v1` (no second appointment database),
  with `source:"website"`, `websiteRef`, `websiteSlot`, `doctorId`, and the «🌐 الموقع» label.

## 5. Rules changed
All clinic paths now require `canManageClinic(clinicId)` instead of `isSignedIn()`;
`users` create is admin-only; new `clinicMembers`; `publicAvailability` write restricted;
booking validation (directory, schedule, break, grid, date window, busy list, lock) added;
platform admin no longer includes role "admin" (that is the clinic manager). Storage rules updated the same way.

## 6. Tenant-protected Clinic Management paths
`bookings`, `prescriptions`, `appData`, `patientRecords`, `dentalCharts`, `websiteBookings` (read/update/delete),
`bookedSlots` (delete), `publicAvailability` (write), Storage `clinics/{c}/attachments/**`.

## 7. Public (not signed in)
Read: websiteDirectory, websiteSettings, services, publicAvailability, bookedSlots (date/time/doctorId only).
Create: one websiteBookings + its bookedSlots lock, only if valid. Nothing else — no patient data, no bookings.

## 8. Doctor / clinic accounts
Full access to their own clinic only. Website editing (websiteSettings, services) for roles doctor/admin/owner of
that clinic. Ordinary "user" staff can use the clinic app but cannot edit the website.

## 9. Platform admin
mostafa.hegab83@gmail.com (or users role superadmin/super_admin): all clinics, directory, users, clinicMembers.

## 10. Double booking
One atomic batch creates the request + lock. Rules reject it if the lock already exists, if the slot is in the
clinic's busy list, or if it is off-schedule. Message: «عذرًا، هذا الموعد لم يعد متاحًا. يرجى اختيار موعد آخر.»
The lock is released only when the owning clinic booking is cancelled, moved, or deleted by staff — never
merely because the request was imported.

## 11. Multi-doctor
Locks and busy entries include doctorId, so Ahmed 10:00 and Sara 10:00 never block each other.
A second site for the same clinic can be created (admin asks for confirmation).

## 12. Remaining limitations (honest)
- **Spam:** Firestore Rules cannot stop automated fake bookings. A bot can fill free slots with fake names.
  Stronger protection needs **Firebase App Check with reCAPTCHA v3/Enterprise** (site key + enforce App Check for
  Firestore in the console + 3 lines in firebase-config.js) — or a backend (Cloud Functions) for per-phone limits.
  Not added yet.
- **busy list freshness:** manual clinic bookings reach the website only while someone has the clinic app open
  (it republishes every 30 s). Website-vs-website double booking is always blocked by the lock.
- **Email bridge:** clinicMembers trusts the Firebase sign-in email. Make sure every email listed there already
  has an account; otherwise someone could register that email first.
- **Shared page content:** sites of the same clinic share one page content (photo/bio) — booking is per doctor.
- **Rules reads:** a booking uses ~5 document reads in the rules (normal, billed as reads).
