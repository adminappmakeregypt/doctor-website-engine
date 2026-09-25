# Doctor Website Engine

قالب موقع طبي واحد يخدم كل الأطباء من نفس الكود. يعرض بيانات كل طبيب حسب الـ slug من Firebase.

## الملفات
- `index.html` + `site.js` + `styles.css` — الموقع العام (يقرأ البيانات مباشرة من Firebase ويحدّثها لحظياً).
- `404.html` — يجعل الروابط مثل `/dr-ahmed` تعمل على GitHub Pages.
- `firebase-config.js` — نفس مشروع Firebase الخاص بتطبيق العيادة.
- `seed-demo.html` — صفحة لمرة واحدة لإنشاء بيانات العيادة التجريبية (تتطلب تسجيل الدخول).
- `doctor.html` + `doctor.js` + `doctor.css` — لوحة الطبيب: يعدّل الطبيب بياناته وصوره وخدماته ومواعيده وبيانات التواصل.
- `admin.html` + `admin.js` + `admin.css` — لوحة المدير: إضافة طبيب، تفعيل/إيقاف الموقع، تعديل البيانات والرابط، حذف الموقع.

## الروابط
- `https://<user>.github.io/<repo>/dr-ahmed`
- أو مباشرة: `index.html?slug=dr-ahmed`

## بنية البيانات في Firestore
```
clinics/{clinicId}/websiteSettings/main
clinics/{clinicId}/services/{serviceId}
websiteDirectory/{slug} -> { clinicId }     // فهرس سريع للرابط
users/{uid} -> { role, clinicId, email, name, isActive, createdAt }
```

`websiteSettings/main` يحتوي على:
`isWebsiteEnabled, slug, doctorName, doctorTitle, specialty, subSpecialty,
profileImage, coverImage, logo, aboutDoctor, qualifications, experience,
clinicName, phone, whatsapp, email, address, googleMapsUrl, socialMedia,
workingHours, themeSettings`

لا توجد أي بيانات مرضى أو سجلات طبية في هذا المشروع.

## قواعد الأمان
القواعد الكاملة والآمنة موجودة في الملفين `firestore.rules` و `storage.rules`.
- انسخ محتوى `firestore.rules` إلى Firebase Console ← Firestore ← Rules داخل `match /databases/{database}/documents` بجانب قواعد تطبيق العيادة.
- انسخ محتوى `storage.rules` إلى Firebase Console ← Storage ← Rules.
- الكتابة في `websiteDirectory` و `users` للمدير فقط، والطبيب يعدّل عيادته فقط ولا يستطيع تغيير دوره أو عيادته.

## لوحة المدير (`admin.html`)
- الدخول: بريد ضمن `SUPER_ADMIN_EMAILS` في أعلى `admin.js`، أو `users/{uid}.role` = `superadmin` / `admin` / `owner`.
  عدّل القائمة في `admin.js` ليكون بريدك هو بريد المدير.
- إضافة طبيب: تنشئ `clinics/{clinicId}/websiteSettings/main` + `websiteDirectory/{slug}`، واختيارياً حساب دخول للطبيب
  (`users/{uid}` بدور `doctor`) عبر تطبيق Firebase ثانوي حتى لا تخرج من حسابك.
- الحذف يمسح إعدادات الموقع والرابط فقط — لا يمس بيانات العيادة أو المرضى.

## لوحة الطبيب (`doctor.html`)
- يسجّل الطبيب الدخول بالبريد وكلمة المرور التي أنشأها المدير.
- يتم تحديد عيادته من `users/{uid}.clinicId`، أو من `websiteDirectory/{slug}.doctorEmail` كبديل.
- الأقسام: بياناتي (الاسم/اللقب/التخصص/الصور/اللون/تفعيل الموقع)، النبذة والمؤهلات، الخدمات (إضافة/إخفاء/حذف)،
  مواعيد العمل (٧ أيام)، بيانات التواصل وحسابات السوشيال.
- الصور تُرفع إلى Firebase Storage على المسار `clinics/{clinicId}/attachments/website/{profile|cover|logo}/...`.
- كل حفظ ينعكس على الموقع العام مباشرة (onSnapshot) دون إعادة نشر.

### الحماية في لوحة الطبيب
- الحساب الموقوف (`isActive: false`) أو الذي دوره ليس `doctor` لا يدخل اللوحة.

## تحسينات v19
- إنشاء الطبيب: يُنشأ حساب الدخول أولاً، وإن فشل لا يُنشأ الموقع (لا مواقع ناقصة).
- زر «🔑 حساب الطبيب» في لوحة المدير لإنشاء أو ربط حساب موجود بموقع.
- حذف الموقع يوقف حسابات الأطباء المرتبطة (حذف حساب الدخول نهائياً من Firebase Console).
- تغيير الرابط يحتفظ ببريد الطبيب.

## v20 — الحجز من الموقع مربوط بتطبيق العيادة
- زر «احجز موعد» يفتح نموذج حجز (الاسم، الهاتف، التاريخ، الوقت، سبب الزيارة).
- المواعيد المتاحة تأتي من «إعدادات المواعيد» في تطبيق العيادة (clinics/{clinicId}/publicAvailability/main) مع استبعاد المحجوز.
- الطلب يُحفظ في clinics/{clinicId}/websiteBookings ويُقفل الموعد في clinics/{clinicId}/bookedSlots — القواعد ترفض حجز نفس الموعد مرتين.
- تطبيق العيادة (website-bookings.js) ينقل الطلب تلقائيًا لقائمة الحجوزات الموجودة بحالة «مجدول» ومصدر website.
- حقول جديدة في websiteSettings/main: onlineBookingEnabled، bookingInstructions، bookingDoctorName.
- يجب نشر firestore.rules (نسخة كاملة) في Firebase Console.
