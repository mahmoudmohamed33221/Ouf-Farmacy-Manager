// ===== إعدادات إدارة صيدلية عوف =====
// ده الملف الوحيد اللي بتعدل فيه الإعدادات من غير ما تلمس الكود.
// (self بدل window علشان الملف ده بيتقرا كمان جوه الـ service worker)
self.APP_CONFIG = {
  APP_NAME: "إدارة صيدلية عوف",

  // رابط سكربت الإدارة (Apps Script Web App - ملف backend/manager.gs). اتركه فاضي لحد ما تنشره، وبعدين الصق الرابط هنا.
  MANAGER_URL: "https://script.google.com/macros/s/AKfycbwpDKBzVxK_JnPi17_RQeUN9Mk7GcCaEMeWDzz2hv217VKhdownm4JolrlXEemLUn0/exec",

  POLL_MS: 10000,   // كل كام ملّي ثانية البرنامج يحدّث البيانات (والتطبيق ظاهر)

  APP_VERSION: "1.0.2",
  BUILD: "__BUILD__"   // بيتستبدل تلقائي عند كل نشر على GitHub
};
