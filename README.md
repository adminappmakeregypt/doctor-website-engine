# Doctor Website Engine

قالب موقع طبي واحد يخدم كل الأطباء من نفس الكود. يعرض بيانات كل طبيب حسب الـ slug من Firebase.

## الملفات
- `index.html` + `site.js` + `styles.css` — الموقع العام (يقرأ البيانات مباشرة من Firebase ويحدّثها لحظياً).
- `404.html` — يجعل الروابط مثل `/dr-ahmed` تعمل على GitHub Pages.
- `firebase-config.js` — نفس مشروع Firebase الخاص بتطبيق العيادة.
- `seed-demo.html` — صفحة لمرة واحدة لإنشاء بيانات العيادة التجريبية (تتطلب تسجيل الدخول).
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

## قواعد الأمان المطلوبة (Firestore Rules)
```
match /websiteDirectory/{slug} {
  allow read: if true;
  allow write: if request.auth != null;
}
match /clinics/{clinicId}/websiteSettings/{docId} {
  allow read: if true;
  allow write: if request.auth != null &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.clinicId == clinicId;
}
match /clinics/{clinicId}/services/{serviceId} {
  allow read: if true;
  allow write: if request.auth != null &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.clinicId == clinicId;
}
```

## لوحة المدير (`admin.html`)
- الدخول: بريد ضمن `SUPER_ADMIN_EMAILS` في أعلى `admin.js`، أو `users/{uid}.role` = `superadmin` / `admin` / `owner`.
  عدّل القائمة في `admin.js` ليكون بريدك هو بريد المدير.
- إضافة طبيب: تنشئ `clinics/{clinicId}/websiteSettings/main` + `websiteDirectory/{slug}`، واختيارياً حساب دخول للطبيب
  (`users/{uid}` بدور `doctor`) عبر تطبيق Firebase ثانوي حتى لا تخرج من حسابك.
- الحذف يمسح إعدادات الموقع والرابط فقط — لا يمس بيانات العيادة أو المرضى.

## قاعدة أمان إضافية للمستخدمين
```
match /users/{uid} {
  allow read: if request.auth != null;
  allow write: if request.auth != null;
}
```

## القادم
لوحة الطبيب `/doctor-login` ليحرّر الطبيب نبذته وخدماته ومواعيده وصوره، ثم ربط زر «احجز موعد» بتطبيق إدارة العيادة.
