// =========================================================================
// 🔴 باك اند "إدارة صيدلية عوف" — مشروع Apps Script مستقل (منفصل عن مشروع "اوردارس").
// بيفتح نفس شيت الصيدلية بالـ ID، فبيشتغل على نفس بيانات الطيارين والعملاء والطلبات لحظيًا.
//
// الخطوات (مرة واحدة):
//  1) script.google.com ← New project ← سمّيه "ادارة صيدلية عوف" ← الصق الملف ده كله.
//  2) شغّل الدالة setupManagerSheet (بتعمل ورقة "إدارة صيدلية عوف" جاهزة) ووافق على الصلاحيات.
//  3) Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone.
//  4) انسخ الرابط وحطه في www/config.js في MANAGER_URL.
//  5) سجّل أول مسؤول من التطبيق، وبعدين من الشيت غيّر "حالة الطلب" بتاعه لـ "مقبول".
//  لو عدّلت الكود بعد كده: Deploy ← Manage deployments ← Edit ← Version: New version (نفس الرابط).
//
// الأمان: كل طلب (غير الدخول والتسجيل) لازم يجي معاه رقم المسؤول + توكن، والسكربت بيتحقق منه
// ومن حالة حسابه في كل مرة. التوكن بيتغير لوحده لو الباسورد اتغير.
// =========================================================================

var SPREADSHEET_ID = "199-5mWgHEsepqmA8b5CmONGD8sBGctxKyoKBeFN-Otk";   // نفس شيت الصيدلية
var TZ = "Africa/Cairo";
var ADMIN_TAB = "إدارة صيدلية عوف", PIL_TAB = "الطيارين", CUS_TAB = "العملاء", ORD_TAB = "الطلبات", ARC_TAB = "الطلبات المكتملة";
var APP_VERSION = "1.0.2";
var LOGIN_MAX_FAILS = 8;
var ARCHIVE_LIMIT = 150;               // أقصى عدد طلبات مكتملة بتتعرض (الأحدث أولًا)

// ورقة الإدارة: صف 1 عناوين الإعدادات، صف 2 قيمها (A2 إصدار / B2 رابط تحديث / C2 حالة الخدمة)، صف 3 عناوين الجدول، والبيانات من صف 4
var ADM = { START: 4, COLS: 11, PHONE: 3, PASS: 4, REQ: 9, STATE: 11 };
var ADM_HEADERS = ["رقم", "الاسم", "رقم الهاتف", "الباسورد", "العنوان", "الرقم القومي", "تاريخ الميلاد", "السن الحالي", "حالة الطلب", "تاريخ ووقت الطلب", "حالة المسؤول"];

// أعمدة "الطيارين" (نفس تطبيق الطيار بالظبط)
var P = { NUM: 1, NAME: 2, PHONE: 3, PASS: 4, ADDR: 5, ID: 6, BIRTH: 7, AGE: 8, VEH: 9, REQ: 10, REQ_AT: 11, STATE: 12, SHIFT: 13, WALLET: 14, TOKEN: 15 };
var PIL_COLS = 15;
var PIL_HEADERS = ["رقم", "اسم الطيار", "رقم الهاتف", "الباسورد", "العنوان", "رقم البطاقه", "تاريخ الميلاد", "السن الحالي", "المركبه", "حالة الطلب", "وقت وتارخ قبول الطلب", "حالة الطيار", "شيفت الطيار", "المحفظه", "توكن الإشعارات"];
var P_DEF_ = {}; Object.keys(P).forEach(function (k) { P_DEF_[k] = P[k]; });
var VEHICLES = ["موتوسيكل", "عجلة كهربائية", "عجلة عادية", "سكوتر"];
var REQ_LIST = ["منتظر", "مقبول", "مرفوض"], STATE_LIST = ["يعمل", "موقوف مؤقتاً", "موقوف نهائي"];

// أعمدة "العملاء"
var C = { NUM: 1, NAME: 2, PHONE: 3, ADDR: 4, LOC: 5, DEALS: 6, STATUS: 7, PROG: 8, DEV: 9 };
var CUST_STATUS = ["جيد", "موقوف"], CUST_PROG = ["يعمل", "حذف"];

// أعمدة "الطلبات" / "الطلبات المكتملة": نفس ترتيب سكربت الطلبات الحالي، لكن ببنربطها بأسماء الهيدر (الصف الأول) في كل طلب،
// فلو غيّرت ترتيب الأعمدة أو أضفت أعمدة مفيش حاجة بتتلخبط. (متغيّرش اسم هيدر عمود من اللي الكود بيستخدمهم)
var HDR_RATE = "تسعيرة الكيلو", HDR_P1N = "اسم الطيار السابق المستلم 1", HDR_P1P = "رقم الطيار السابق المستلم 1", HDR_P2N = "اسم الطيار السابق المستلم 2", HDR_P2P = "رقم الطيار السابق المستلم 2";
var HDR_ACC_AT = "وقت قبول الطلب", HDR_PREP_END = "وقت انتهاء التجهيز", HDR_DELIV_AT = "وقت بدء التوصيل", HDR_DONE_AT = "وقت التسليم", HDR_TOTAL_MIN = "إجمالي المدة (دقيقة)", HDR_PHARM_AT = "وقت الوصول للصيدلية (لا تلمسه)";
var TS_FMT_ = "dd/MM/yyyy hh:mm a";      // شكل الأوقات في الشيت (بتوقيت الشيت)
var ORD_HEADERS = ["رقم", "رقم البون", "التاريخ واليوم", "الوقت", "اسم العميل", "رقم التليفون", "اسم العزبة / المنطقة", "الشارع / شارع كام",
  "علامة مميزة بجوار البيت", "لوكيشن العميل", "تفاصيل الأوردر", "لوكيشن المحل", "ملحوظة", "اجمالي حساب العميل", HDR_RATE, "تم قبول الاوردر", HDR_ACC_AT,
  HDR_P1N, HDR_P1P, HDR_P2N, HDR_P2P, "اسم الطيار المستلم", "رقم الطيار المستلم", "الوصول الي المحل خلال", "جاري التجهيز", HDR_PREP_END, "جاري التوصيل", HDR_DELIV_AT, "الوصول الي العميل خلال",
  "تم التوصيل", HDR_DONE_AT, HDR_TOTAL_MIN, "نتيجة الإشعار", "خطوات التنفيذ"];
var O = { NUM: 1, BON: 2, DATE: 3, TIME: 4, NAME: 5, PHONE: 6, AREA: 7, STREET: 8, LANDMARK: 9, CLOC: 10, DETAILS: 11, SLOC: 12, NOTE: 13, TOTAL: 14, RATE: 15,
  ACCEPT: 16, ACC_AT: 17, P1N: 18, P1P: 19, P2N: 20, P2P: 21, PNAME: 22, PPHONE: 23, SHOP_ETA: 24, PREP: 25, PREP_END: 26, DELIV: 27, DELIV_AT: 28, CUST_ETA: 29,
  DONE: 30, DONE_AT: 31, TOTAL_MIN: 32, NOTIF: 33, STEPS: 34 };
var O_CID = 35;    // عمود مخفي: معرّف الطلب (بيربط الطلب بالجهاز اللي عمله، ومنه بيتمنع التكرار وبيتحمي خصوصية العميل)
// أعمدة مساعدة بعد معرّف الطلب (أرقام فعلية بيقراها البرنامجين، وعمود "اجمالي حساب العميل" بيتكتب نص: ح 1150 + ت 100 = ا 1250)
var O_KM = 36, O_FEE = 37, O_GOODS = 38, O_SIG = 39, O_PHARM = 40, O_ARR = 41;      // O_PHARM مخفي: وقت وصول المندوب للصيدلية (بيتحسب منه إجمالي المدة)
var HELPER_HEADERS = ["معرّف الطلب (لا تلمسه)", "المسافة (كم)", "قيمة التوصيل", "حساب البضاعة", "بصمة التسعير (لا تلمسها)", HDR_PHARM_AT, "وصول المندوب"];
var A_AT = 42;     // في ورقة المكتملة: وقت الأرشفة
var TS_FMT_ = "dd/MM/yyyy hh:mm a";
var ARC_AT_HDR = "وقت الأرشفة";
var O_DEF_ = {}, H_DEF_ = { CID: O_CID, KM: O_KM, FEE: O_FEE, GOODS: O_GOODS, SIG: O_SIG, PHARM: O_PHARM, ARR: O_ARR }, A_AT_DEF_ = A_AT;
var HKEYS_ = ["CID", "KM", "FEE", "GOODS", "SIG", "PHARM", "ARR"], O_W = O_ARR, ARC_MAP_ = null, BOUND_ = false;
Object.keys(O).forEach(function (k) { O_DEF_[k] = O[k]; });
function normH_(h) { return String(h == null ? "" : h).replace(/[\u200e\u200f\u202a-\u202e\u00a0]/g, "").replace(/\s+/g, " ").trim(); }
function hdrRow_(sh) { return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(normH_); }
function bindOrders_(sh) {
  var row = hdrRow_(sh), find = function (hd, def) { var i = row.indexOf(normH_(hd)); return i < 0 ? def : i + 1; }, mx = 0;
  Object.keys(O_DEF_).forEach(function (k) { O[k] = find(ORD_HEADERS[O_DEF_[k] - 1], O_DEF_[k]); mx = Math.max(mx, O[k]); });
  O_CID = find(HELPER_HEADERS[0], H_DEF_.CID); O_KM = find(HELPER_HEADERS[1], H_DEF_.KM); O_FEE = find(HELPER_HEADERS[2], H_DEF_.FEE); O_GOODS = find(HELPER_HEADERS[3], H_DEF_.GOODS);
  O_SIG = find(HELPER_HEADERS[4], H_DEF_.SIG); O_PHARM = find(HELPER_HEADERS[5], H_DEF_.PHARM); O_ARR = find(HELPER_HEADERS[6], H_DEF_.ARR);
  O_W = Math.max(mx, O_CID, O_KM, O_FEE, O_GOODS, O_SIG, O_PHARM, O_ARR); A_AT = O_W + 1; ARC_MAP_ = null;
}
function bindPilots_(sh) {
  var row = hdrRow_(sh), mx = 0;
  Object.keys(P_DEF_).forEach(function (k) { var i = row.indexOf(normH_(PIL_HEADERS[P_DEF_[k] - 1])); P[k] = i < 0 ? P_DEF_[k] : i + 1; mx = Math.max(mx, P[k]); });
  PIL_COLS = Math.max(mx, 1);
}
function bindAll_() {                       // بيتنادى مرة في أول كل طلب للسيرفر
  if (BOUND_) return; var ss = ss_(), o = tab_(ORD_TAB), p = tab_(PIL_TAB);
  if (o && o.getLastColumn() > 0) bindOrders_(o);
  if (p && p.getLastColumn() > 0) bindPilots_(p);
  BOUND_ = true;
}
function arcCols_(arc) {                    // أعمدة ورقة الأرشيف بالهيدر (ممكن ترتيبها يختلف عن الطلبات)
  var id = arc.getSheetId(); if (ARC_MAP_ && ARC_MAP_.id === id) return ARC_MAP_.m;
  var row = hdrRow_(arc), m = {}, f = function (hd) { var i = row.indexOf(normH_(hd)); return i < 0 ? 0 : i + 1; };
  Object.keys(O_DEF_).forEach(function (k) { m[k] = f(ORD_HEADERS[O_DEF_[k] - 1]); });
  HKEYS_.forEach(function (k, i) { m[k] = f(HELPER_HEADERS[i]); });
  m.AT = f(ARC_AT_HDR); ARC_MAP_ = { id: id, m: m }; return m;
}
function canonArc_(arc, rows) {             // صفوف الأرشيف ← نفس ترتيب أعمدة "الطلبات" (علشان باقي الكود يشتغل بنفس الأرقام)
  var m = arcCols_(arc), keys = Object.keys(m);
  var dst = function (k) { return k === "AT" ? A_AT : (k in O ? O[k] : { CID: O_CID, KM: O_KM, FEE: O_FEE, GOODS: O_GOODS, SIG: O_SIG, PHARM: O_PHARM, ARR: O_ARR }[k]); };
  var idx = {}; keys.forEach(function (k) { idx[k] = dst(k); });
  return rows.map(function (rw) {
    var o = []; for (var i = 0; i < A_AT; i++) o.push("");
    keys.forEach(function (k) { if (m[k] && idx[k]) { var v = rw[m[k] - 1]; o[idx[k] - 1] = v === undefined ? "" : v; } });
    return o;
  });
}
function toMs_(v) { if (v instanceof Date) { var t = v.getTime(); return isFinite(t) ? t : 0; } var n = Number(v); return n > 1e11 ? n : 0; }

// ===================== أدوات =====================
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function key_(n) { return String(n).replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي"); }
function tab_(name) {                       // بيلاقي الورقة حتى لو فيها مسافة زيادة أو اختلاف ا/أ، ة/ه
  var ss = ss_(), sh = ss.getSheetByName(name); if (sh) return sh;
  var w = key_(name), all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (key_(all[i].getName()) === w) return all[i];
  return null;
}
function normPhone_(v) {
  var s = String(v == null ? "" : v).replace(/[٠-٩]/g, function (x) { return "٠١٢٣٤٥٦٧٨٩".indexOf(x); }).replace(/\D/g, "");
  if (s.indexOf("20") === 0 && s.length === 12) s = "0" + s.slice(2);
  if (/^1[0125]\d{8}$/.test(s)) s = "0" + s;
  return s;
}
function txt_(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === "TRUE"; }
function isAcc_(s) { return s === "مقبول" || s === "تم القبول"; }
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { try { l.releaseLock(); } catch (x) {} } }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy hh:mm a"); }

// ===================== الدخول بالتوكن =====================
function secret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty("MGR_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("MGR_SECRET", s); }
  return s;
}
function tokenFor_(phone, pass) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(phone + "|" + pass, secret_())); }

function adminRows_() {
  var sh = tab_(ADMIN_TAB); if (!sh) return { sh: null, rows: [] };
  var last = sh.getLastRow(); if (last < ADM.START) return { sh: sh, rows: [] };
  return { sh: sh, rows: sh.getRange(ADM.START, 1, last - ADM.START + 1, ADM.COLS).getValues() };
}
function findAdmin_(phone) {
  var a = adminRows_();
  for (var i = 0; i < a.rows.length; i++) if (normPhone_(a.rows[i][ADM.PHONE - 1]) === phone) return { sh: a.sh, row: ADM.START + i, v: a.rows[i] };
  return null;
}
function adminState_(v) {
  var st = String(v[ADM.STATE - 1] || "").trim(), rq = String(v[ADM.REQ - 1] || "").trim();
  if (st === "موقوف نهائي" || st === "موقوف دائم") return { status: "suspended_permanent", message: "تم إيقاف حسابك بشكل دائم" };
  if (st === "موقوف مؤقتاً" || st === "موقوف مؤقتا") return { status: "suspended_temp", message: "أنت موقوف مؤقتًا، تواصل مع الإدارة" };
  if (rq === "مرفوض") return { status: "rejected", message: "تم رفض طلب انضمامك" };
  if (!isAcc_(rq)) return { status: "pending_approval", message: "حسابك قيد المراجعة" };
  return { status: "ok" };
}
function authed_(d) {                       // بيرجع null لو كله تمام، أو رد الخطأ
  var phone = normPhone_(d.phone), a = phone ? findAdmin_(phone) : null;
  if (!a || !d.token || String(d.token) !== tokenFor_(phone, String(a.v[ADM.PASS - 1]).trim())) return { status: "unauthorized" };
  var st = adminState_(a.v); return st.status === "ok" ? null : st;
}

function adminLogin_(d) {
  var phone = normPhone_(d.phone), pass = String(d.password == null ? "" : d.password).trim();
  if (!phone || !pass) return { status: "error", message: "البيانات ناقصة" };
  if (!tab_(ADMIN_TAB)) return { status: "error", message: "ورقة \"" + ADMIN_TAB + "\" غير موجودة، شغّل setupManagerSheet" };
  var cache = CacheService.getScriptCache(), fk = "mf_" + phone;
  if (Number(cache.get(fk) || 0) >= LOGIN_MAX_FAILS) return { status: "error", message: "محاولات كتير غلط، جرّب كمان 10 دقايق" };
  var a = findAdmin_(phone);
  if (!a) return { status: "not_found", message: "هذا الرقم غير مسجل لدينا" };
  if (String(a.v[ADM.PASS - 1]).trim() !== pass) { cache.put(fk, String(Number(cache.get(fk) || 0) + 1), 600); return { status: "wrong_password", message: "كلمة المرور غير صحيحة" }; }
  cache.remove(fk);
  var st = adminState_(a.v); if (st.status !== "ok") return st;
  var v = a.v;
  return { status: "success", name: v[1], token: tokenFor_(phone, pass),
    personData: { name: v[1], phone: phone, address: v[4], idCard: String(v[5]).replace(/'/g, ""), birthDate: String(v[6]), age: v[7] } };
}

function adminRegister_(d) {
  var name = txt_(d.name, 80).replace(/\s+/g, " "), phone = normPhone_(d.phone), pass = String(d.password == null ? "" : d.password).trim();
  var addr = txt_(d.address, 200), idc = String(d.idCard || "").replace(/\D/g, ""), bd = txt_(d.birthDate, 20);
  if (name.split(" ").length < 3) return { status: "error", message: "اكتب الاسم ثلاثي أو رباعي" };
  if (!/^01[0125]\d{8}$/.test(phone)) return { status: "error", message: "رقم الموبايل لازم يكون مصري من 11 رقم" };
  if (pass.length < 6) return { status: "error", message: "كلمة المرور 6 حروف أو أرقام على الأقل" };
  if (addr.length < 6) return { status: "error", message: "اكتب العنوان بالتفصيل" };
  if (!/^\d{14}$/.test(idc)) return { status: "error", message: "الرقم القومي 14 رقم" };
  if (!bd) return { status: "error", message: "اختار تاريخ الميلاد" };
  var sh = tab_(ADMIN_TAB); if (!sh) return { status: "error", message: "ورقة الإدارة غير موجودة، شغّل setupManagerSheet" };
  if (findAdmin_(phone)) return { status: "error", message: "رقم الهاتف مسجل بالفعل!" };
  var last = sh.getLastRow(), r = Math.max(last + 1, ADM.START), n = last >= ADM.START ? last - ADM.START + 2 : 1;
  var m = bd.match(/^(\d{4})-(\d{2})-(\d{2})$/), age = Number(d.age) || "";
  var bdOut = m ? m[3] + "/" + m[2] + "/" + m[1] : bd;
  sh.getRange(r, 1, 1, ADM.COLS).setNumberFormat("@");
  sh.getRange(r, 1, 1, ADM.COLS).setValues([[n, name, phone, pass, addr, idc, bdOut, age, "منتظر", nowStr_(), "يعمل"]]);
  styleAdminRow_(sh, r);
  return { status: "success", message: "تم تقديم طلبك وهو الآن (منتظر)" };
}
function styleAdminRow_(sh, r) {
  var rq = String(sh.getRange(r, ADM.REQ).getValue()).trim(), bg = "#111827", fg = "#F3F4F6";
  if (rq === "منتظر") { bg = "#8A6D00"; fg = "#FFF6CC"; } else if (rq === "مرفوض") { bg = "#7A1212"; fg = "#FFE1E1"; } else if (rq) { bg = "#4C0519"; fg = "#FFE1E9"; }
  sh.getRange(r, 1, 1, ADM.COLS).setBackground(bg).setFontColor(fg);
}

// ===================== الراوتر =====================
function doGet() { return out_({ ok: true, service: "ouf-manager", version: APP_VERSION }); }

var WRITES_ = { updatePersonStatus: 1, updatePersonInfo: 1, updateCustomerStatus: 1, reassignPilot: 1, withdrawOrder: 1, cancelOrder: 1, updateOrderLocation: 1 };
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents), a = d.action;
    if (a === "adminLogin") return out_(adminLogin_(d));
    if (a === "adminRegister") return out_(withLock_(function () { return adminRegister_(d); }));
    var bad = authed_(d); if (bad) return out_(bad);
    bindAll_();
    if (a === "adminStatus") return out_({ status: "active" });
    if (a === "getPeopleList" || a === "getPilots") return out_({ status: "success", list: getPilots_() });
    if (a === "getCustomers") return out_({ status: "success", list: getCustomers_() });
    if (a === "getOrdersForAdmin") return out_(getOrders_(String(d.phase || "new")));
    if (a === "resolveLocation") return out_(resolveLocation_(d.loc));
    if (WRITES_[a]) return out_(withLock_(function () {
      if (a === "updatePersonStatus") return updatePilotStatus_(normPhone_(d.phone), d.requestStatus, d.personStatus);
      if (a === "updatePersonInfo") return updatePilotInfo_(normPhone_(d.originalPhone), d.fields || {});
      if (a === "updateCustomerStatus") return updateCustomer_(normPhone_(d.phone), d.status, d.prog);
      if (a === "reassignPilot") return reassignPilot_(d.bon, normPhone_(d.pilotPhone));
      if (a === "withdrawOrder") return withdrawOrder_(d.bon);
      if (a === "updateOrderLocation") return updateOrderLocation_(d.bon, String(d.which || ""), d.loc);
      return cancelOrder_(d.bon);
    }));
    return out_({ status: "error", message: "أمر غير معروف" });
  } catch (err) { return out_({ status: "error", message: String(err) }); }
}

// ===================== الطيارين =====================
function pilotLast_(sh) {
  var n = sh.getMaxRows(); if (n < 2) return 1;
  var v = sh.getRange(2, P.PHONE, n - 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim() !== "") return i + 2;
  return 1;
}
function getPilots_() {                     // كل الطيارين (التقسيم لقوائم بيتم في التطبيق علشان التعديل اللحظي)
  var sh = tab_(PIL_TAB); if (!sh) return [];
  var last = pilotLast_(sh); if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, PIL_COLS).getDisplayValues(), out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({ phone: normPhone_(r[P.PHONE - 1]) || r[P.PHONE - 1], name: r[P.NAME - 1], password: r[P.PASS - 1], address: r[P.ADDR - 1], idCard: r[P.ID - 1],
      birthDate: r[P.BIRTH - 1], age: r[P.AGE - 1], vehicle: r[P.VEH - 1], requestStatus: String(r[P.REQ - 1]).trim(), assignDate: r[P.REQ_AT - 1],
      personStatus: String(r[P.STATE - 1]).trim(), shift: String(r[P.SHIFT - 1]).trim(), wallet: Number(r[P.WALLET - 1]) || 0 });
  }
  return out;
}
function findPilotRow_(sh, phone) {
  var last = pilotLast_(sh); if (last < 2 || !phone) return 0;
  var v = sh.getRange(2, P.PHONE, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (normPhone_(v[i][0]) === phone) return i + 2;
  return 0;
}
function stylePilotRow_(sh, r) {            // نفس ألوان تطبيق الطيار
  var rq = String(sh.getRange(r, P.REQ).getValue()).trim(), st = String(sh.getRange(r, P.STATE).getValue()).trim(), bg = "#111827", fg = "#F3F4F6";
  if (st === "موقوف نهائي") { bg = "#FF1744"; fg = "#000000"; } else if (rq === "منتظر") { bg = "#FFEB3B"; fg = "#000000"; }
  else if (rq === "مرفوض") { bg = "#7A1212"; fg = "#FFFFFF"; } else if (rq) { bg = "#FFFFFF"; fg = "#000000"; }
  sh.getRange(r, 1, 1, PIL_COLS).setBackground(bg).setFontColor(fg);
}
function updatePilotStatus_(phone, req, state) {
  var sh = tab_(PIL_TAB); if (!sh) return { status: "error", message: "ورقة الطيارين غير موجودة" };
  var r = findPilotRow_(sh, phone); if (!r) return { status: "error", message: "الطيار غير موجود" };
  if (req && REQ_LIST.indexOf(req) < 0) return { status: "error", message: "حالة طلب غير صحيحة" };
  if (state && STATE_LIST.indexOf(state) < 0) return { status: "error", message: "حالة طيار غير صحيحة" };
  if (req) {
    sh.getRange(r, P.REQ).setValue(req);
    if (req === "مقبول" && !sh.getRange(r, P.REQ_AT).getValue()) sh.getRange(r, P.REQ_AT).setNumberFormat("@").setValue(nowStr_());   // زي onEdit في الشيت
  }
  if (state) sh.getRange(r, P.STATE).setValue(state);
  stylePilotRow_(sh, r);
  return { status: "success" };
}
function updatePilotInfo_(orig, f) {
  var sh = tab_(PIL_TAB); if (!sh) return { status: "error", message: "ورقة الطيارين غير موجودة" };
  var r = findPilotRow_(sh, orig); if (!r) return { status: "error", message: "الطيار غير موجود" };
  var phone = f.phone !== undefined && String(f.phone).trim() !== "" ? normPhone_(f.phone) : "";
  if (phone) {
    if (!/^01[0125]\d{8}$/.test(phone)) return { status: "error", message: "رقم الهاتف لازم يكون مصري من 11 رقم" };
    var other = findPilotRow_(sh, phone); if (other && other !== r) return { status: "error", message: "الرقم ده مسجل لطيار تاني" };
  }
  var idc = f.idCard !== undefined ? String(f.idCard).replace(/\D/g, "") : "";
  if (f.idCard !== undefined && String(f.idCard).trim() !== "" && !/^\d{14}$/.test(idc)) return { status: "error", message: "الرقم القومي 14 رقم" };
  var set = function (c, v, text) { var g = sh.getRange(r, c); if (text) g.setNumberFormat("@"); g.setValue(v); };
  if (txt_(f.name, 80)) set(P.NAME, txt_(f.name, 80));
  if (phone) set(P.PHONE, phone, true);
  if (txt_(f.password, 60)) set(P.PASS, txt_(f.password, 60), true);
  if (f.address !== undefined) set(P.ADDR, txt_(f.address, 200));
  if (idc) set(P.ID, idc, true);
  if (f.birthDate !== undefined) set(P.BIRTH, txt_(f.birthDate, 20), true);
  if (String(f.age || "").trim() !== "") set(P.AGE, Number(f.age) || f.age);
  if (f.vehicle !== undefined && String(f.vehicle).trim() !== "") set(P.VEH, txt_(f.vehicle, 30));
  if (String(f.assignDate || "").trim() !== "") set(P.REQ_AT, txt_(f.assignDate, 40), true);
  return { status: "success" };
}

// ===================== العملاء =====================
function getCustomers_() {
  var sh = tab_(CUS_TAB); if (!sh) return [];
  var last = sh.getLastRow(); if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, C.DEV).getDisplayValues(), out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; if (!String(r[C.NAME - 1]).trim()) continue;
    out.push({ id: r[0], name: r[C.NAME - 1], phone: normPhone_(r[C.PHONE - 1]) || r[C.PHONE - 1], address: r[C.ADDR - 1], location: r[C.LOC - 1], deals: r[C.DEALS - 1],
      status: String(r[C.STATUS - 1]).trim() || "جيد", prog: String(r[C.PROG - 1]).trim() || "يعمل" });
  }
  return out.reverse();
}
function updateCustomer_(phone, status, prog) {
  var sh = tab_(CUS_TAB); if (!sh) return { status: "error", message: "ورقة العملاء غير موجودة" };
  if (status && CUST_STATUS.indexOf(status) < 0) return { status: "error", message: "حالة غير صحيحة" };
  if (prog && CUST_PROG.indexOf(prog) < 0) return { status: "error", message: "حالة برنامج غير صحيحة" };
  var last = sh.getLastRow(); if (last < 2) return { status: "error", message: "لا يوجد عملاء" };
  var v = sh.getRange(2, C.PHONE, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (normPhone_(v[i][0]) === phone) {
    if (status) sh.getRange(i + 2, C.STATUS).setValue(status);
    if (prog) sh.getRange(i + 2, C.PROG).setValue(prog);
    return { status: "success" };
  }
  return { status: "error", message: "العميل غير موجود" };
}

// ===================== الطلبات =====================
function dataLast_(sh) {                    // آخر صف فيه أوردر فعلًا (بنعدّ على رقم البون)
  var n = sh.getMaxRows(); if (n < 2) return 1;
  var v = sh.getRange(2, O.BON, n - 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (v[i][0] !== "" && v[i][0] !== null) return i + 2;
  return 1;
}
function num_(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
var AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
// تاريخ ووقت الطلب من النص المعروض في الخلية (نفس منطق تطبيق الطيار)
function orderTime_(dispD, dispT) {
  var y = 0, mo = 0, da = 0, h = -1, mi = 0, m;
  if ((m = String(dispD || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { da = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = String(dispD || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  var ts = String(dispT || "");
  if ((m = ts.match(/(\d{1,2}):(\d{2})/))) { h = +m[1]; mi = +m[2]; var pm = /م|PM/i.test(ts), am = /ص|AM/i.test(ts); if (pm && h < 12) h += 12; if (am && h === 12) h = 0; }
  if (!y || h < 0) return { day: "", dateTxt: String(dispD || ""), timeTxt: String(dispT || ""), ageMin: -1, ms: 0 };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; }, ms = 0, age = -1;
  try { ms = Utilities.parseDate(y + "-" + pad(mo) + "-" + pad(da) + " " + pad(h) + ":" + pad(mi), TZ, "yyyy-MM-dd HH:mm").getTime(); age = Math.max(0, Math.floor((Date.now() - ms) / 60000)); } catch (e) {}
  return { day: AR_DAYS[new Date(y, mo - 1, da).getDay()], dateTxt: pad(da) + "/" + pad(mo) + "/" + y, timeTxt: pad(h % 12 || 12) + ":" + pad(mi) + " " + (h < 12 ? "ص" : "م"), ageMin: age, ms: ms };
}
function orderObj_(rv, dv) {
  var goods = num_(rv[O_GOODS - 1]), fee = num_(rv[O_FEE - 1]);
  if (!isFinite(goods)) {                   // احتياطي: من نص "ح 1150 + ت 100 = ا 1250"
    var m = String(dv[O.TOTAL - 1]).match(/ح\s*([\d.]+)\s*\+\s*ت\s*([\d.]+)/);
    goods = m ? Number(m[1]) : (Number(String(dv[O.TOTAL - 1]).replace(/[^\d.]/g, "")) || 0); fee = m ? Number(m[2]) : 0;
  }
  if (!isFinite(fee)) fee = 0;
  var tm = orderTime_(dv[O.DATE - 1], dv[O.TIME - 1]), s = function (c) { return String(dv[c - 1] == null ? "" : dv[c - 1]).trim(); };
  var stage = isTrue_(rv[O.DELIV - 1]) ? "delivering" : (isTrue_(rv[O.PREP - 1]) ? "preparing" : (isTrue_(rv[O.ACCEPT - 1]) ? "accepted" : "new"));
  return { bon: Number(rv[O.BON - 1]), stage: stage, day: tm.day, dateTxt: tm.dateTxt, timeTxt: tm.timeTxt, ageMin: tm.ageMin, orderMs: tm.ms,
    name: s(O.NAME), phone: normPhone_(dv[O.PHONE - 1]), area: s(O.AREA), street: s(O.STREET), landmark: s(O.LANDMARK), cloc: s(O.CLOC),
    items: String(dv[O.DETAILS - 1] || ""), note: s(O.NOTE), km: Number(rv[O_KM - 1]) || 0, goods: goods, fee: fee, total: Math.round((goods + fee) * 100) / 100,
    pilotName: s(O.PNAME), pilotPhone: normPhone_(dv[O.PPHONE - 1]),
    prev1: s(O.P1N) === "--" ? "" : s(O.P1N), prev1Phone: normPhone_(dv[O.P1P - 1]), prev2: s(O.P2N) === "--" ? "" : s(O.P2N), prev2Phone: normPhone_(dv[O.P2P - 1]),
    shopEta: s(O.SHOP_ETA), custEta: s(O.CUST_ETA), arrived: !!rv[O_ARR - 1], sloc: String(dv[O.SLOC - 1] || "").trim(), accMs: toMs_(rv[O.ACC_AT - 1]) || stepsOf_(rv).a, delivMs: toMs_(rv[O.DELIV_AT - 1]) || stepsOf_(rv).d, doneMs: toMs_(rv[O.DONE_AT - 1]), pharmMs: toMs_(rv[O_PHARM - 1]), prepEndMs: toMs_(rv[O.PREP_END - 1]), totMinSheet: Number(rv[O.TOTAL_MIN - 1]) || 0 };
}
// أوقات المراحل: عمود STEPS بيتكتب فيه "a:وقت-القبول|d:وقت-بدء-التوصيل" بالمللي ثانية (من تعديل بسيط في سكربت الطلبات، شوف orders-patch.txt)
function stepsOf_(rv) {
  var out = { a: 0, d: 0 }; String(rv[O.STEPS - 1] || "").split("|").forEach(function (p) { var x = p.split(":"); if (x[0] === "a" || x[0] === "d") out[x[0]] = Number(x[1]) || 0; });
  return out;
}
function timeTxtMs_(ms) { return ms ? Utilities.formatDate(new Date(ms), TZ, "hh:mm") + " " + (Utilities.formatDate(new Date(ms), TZ, "a") === "AM" ? "ص" : "م") : ""; }
function getOrders_(phase) {
  var list = [];
  if (phase === "delivered") {
    var arc = tab_(ARC_TAB); if (!arc || arc.getLastRow() < 2) return { status: "success", list: [] };
    var last = arc.getLastRow(), from = Math.max(2, last - ARCHIVE_LIMIT + 1), n = last - from + 1, w = Math.max(arc.getLastColumn(), 1);
    var rg = arc.getRange(from, 1, n, w), cm = arcCols_(arc), av = canonArc_(arc, rg.getValues()), ad = canonArc_(arc, rg.getDisplayValues());
    for (var a = av.length - 1; a >= 0; a--) {
      var o = orderObj_(av[a], ad[a]); if (isNaN(o.bon)) continue;
      o.stage = "delivered";
      var at = av[a][A_AT - 1], doneMs = o.doneMs || (at instanceof Date ? at.getTime() : 0);
      if (doneMs) {
        var d = new Date(doneMs);
        o.doneMs = doneMs; o.doneDay = AR_DAYS[Number(Utilities.formatDate(d, TZ, "u")) % 7]; o.doneDateTxt = Utilities.formatDate(d, TZ, "dd/MM/yyyy"); o.doneTimeTxt = timeTxtMs_(doneMs);
        o.durMin = o.orderMs ? Math.max(0, Math.round((doneMs - o.orderMs) / 60000)) : -1;
      } else { o.doneDay = ""; o.doneDateTxt = String(ad[a][A_AT - 1] || ""); o.doneTimeTxt = ""; o.durMin = -1; }
      o.accTxt = timeTxtMs_(o.accMs); o.delivDurMin = (doneMs && o.delivMs && doneMs >= o.delivMs) ? Math.round((doneMs - o.delivMs) / 60000) : -1;
      o.pharmTxt = timeTxtMs_(o.pharmMs); o.prepEndTxt = timeTxtMs_(o.prepEndMs); o.delivTxt = timeTxtMs_(o.delivMs);
      o.prepDurMin = (o.pharmMs && o.prepEndMs && o.prepEndMs >= o.pharmMs) ? Math.round((o.prepEndMs - o.pharmMs) / 60000) : -1;      // مدة التجهيز: من وصول المندوب للصيدلية لحد ما يخلّص التجهيز
      o.totMin = o.totMinSheet || ((doneMs && o.pharmMs && doneMs >= o.pharmMs) ? Math.round((doneMs - o.pharmMs) / 60000) : -1);      // إجمالي المدة: من وصوله للصيدلية لحد التسليم (زي عمود الشيت)
      list.push(o);
    }
    return { status: "success", list: list };
  }
  var sh = tab_(ORD_TAB); if (!sh) return { status: "success", list: [] };
  var lr = dataLast_(sh); if (lr < 2) return { status: "success", list: [] };
  var r2 = sh.getRange(2, 1, lr - 1, O_W), vals = r2.getValues(), disp = r2.getDisplayValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (vals[i][O.BON - 1] === "" || isTrue_(vals[i][O.DONE - 1])) continue;
    list.push(orderObj_(vals[i], disp[i]));
  }
  return { status: "success", list: list };     // كل الطلبات الجارية (جديدة/مقبولة/تجهيز/توصيل)، والتقسيم في التطبيق
}
function pilotLabel_(name, veh) { return String(name) + (veh ? " - " + veh : ""); }
function workingPilot_(phone) {             // الطيار المتاح للتعيين: مقبول + يعمل + شيفت "يعمل الان"
  var all = getPilots_();
  for (var i = 0; i < all.length; i++) if (all[i].phone === phone && isAcc_(all[i].requestStatus) && all[i].personStatus === "يعمل" && all[i].shift === "يعمل الان") return all[i];
  return null;
}
function orderRow_(sh, bon) {
  var lr = dataLast_(sh); if (lr < 2) return 0;
  var b = sh.getRange(2, O.BON, lr - 1, 1).getValues();
  for (var i = 0; i < b.length; i++) if (Number(b[i][0]) === Number(bon)) return i + 2;
  return 0;
}
function styleOrderRow_(sh, r) {            // نفس ألوان تطبيق الطيار
  var v = sh.getRange(r, 1, 1, O_W).getValues()[0], bg = "#0B0F19", fg = "#F3F4F6";
  if (isTrue_(v[O.DONE - 1])) { bg = "#1F2937"; fg = "#9CA3AF"; }
  else if (isTrue_(v[O.DELIV - 1])) { bg = "#ADFF2F"; fg = "#111827"; }
  else if (isTrue_(v[O.PREP - 1])) { bg = "#E0F2FE"; fg = "#111827"; }
  else if (isTrue_(v[O.ACCEPT - 1])) { bg = "#064E3B"; fg = "#F3F4F6"; }
  sh.getRange(r, 1, 1, O_W).setBackground(bg).setFontColor(fg).setVerticalAlignment("middle").setBorder(true, true, true, true, true, true, "#4B5563", SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(r, O.DETAILS).setWrap(true);
}
function pushPrev_(sh, r, name, phone) {    // نفس منطق تطبيق الطيار: السابق 1 ثم 2، وآخر اتنين بس
  name = String(name || "").trim(); if (!name) return;
  var rg = sh.getRange(r, O.P1N, 1, 4), v = rg.getValues()[0];
  if (!String(v[0]).trim() || String(v[0]).trim() === "--") { v[0] = name; v[1] = phone; }
  else if (!String(v[2]).trim() || String(v[2]).trim() === "--") { v[2] = name; v[3] = phone; }
  else { v[0] = v[2]; v[1] = v[3]; v[2] = name; v[3] = phone; }
  rg.setNumberFormat("@"); rg.setValues([[String(v[0]), String(v[1]), String(v[2]), String(v[3])]]);
}
// تحويل الطلب لطيار تاني (في أي مرحلة: مقبول / تجهيز / توصيل). مرحلة الطلب بتفضل زي ما هي والطيار الجديد بيكمل منها.
function reassignPilot_(bon, pilotPhone) {
  var sh = tab_(ORD_TAB); if (!sh) return { status: "error", message: "ورقة الطلبات غير موجودة" };
  var row = orderRow_(sh, bon); if (!row) return { status: "error", message: "الطلب غير موجود (يمكن اتسلّم أو اتلغى)" };
  var rv = sh.getRange(row, 1, 1, O_W).getValues()[0];
  if (!isTrue_(rv[O.ACCEPT - 1])) return { status: "error", message: "الطلب لسه ما اتقبلش من طيار" };
  var np = workingPilot_(pilotPhone);
  if (!np) return { status: "error", message: "الطيار ده مش متاح دلوقتي (لازم مقبول + يعمل + شيفت يعمل الان)" };
  var oldPhone = normPhone_(rv[O.PPHONE - 1]);
  if (oldPhone === pilotPhone) return { status: "error", message: "الطلب معاه نفس الطيار بالفعل" };
  pushPrev_(sh, row, rv[O.PNAME - 1], oldPhone);          // الطيار القديم يتسجل "سابق"
  sh.getRange(row, O.PNAME).setValue(pilotLabel_(np.name, np.vehicle));
  sh.getRange(row, O.PPHONE).setNumberFormat("@").setValue(np.phone);
  sh.getRange(row, O.SHOP_ETA).setValue(""); sh.getRange(row, O.CUST_ETA).setValue("");   // وصول الطيار القديم ميبقاش ظاهر
  sh.getRange(row, O_ARR).setValue("");
  return { status: "success" };
}
// سحب الطلب من الطيار: بيرجع "جديد" ويظهر لكل الطيارين (زي تنازل الطيار بس من الإدارة وفي أي مرحلة)
function withdrawOrder_(bon) {
  var sh = tab_(ORD_TAB); if (!sh) return { status: "error", message: "ورقة الطلبات غير موجودة" };
  var row = orderRow_(sh, bon); if (!row) return { status: "error", message: "الطلب غير موجود (يمكن اتسلّم أو اتلغى)" };
  var rv = sh.getRange(row, 1, 1, O_W).getValues()[0];
  if (!isTrue_(rv[O.ACCEPT - 1])) return { status: "success" };             // لسه جديد أصلًا
  pushPrev_(sh, row, rv[O.PNAME - 1], normPhone_(rv[O.PPHONE - 1]));
  [O.ACCEPT, O.PREP, O.DELIV].forEach(function (c) { sh.getRange(row, c).setValue(false); });
  [O.PNAME, O.PPHONE, O.SHOP_ETA, O.CUST_ETA, O_ARR, O.STEPS].forEach(function (c) { sh.getRange(row, c).setValue(""); });
  [O.ACC_AT, O.PREP_END, O.DELIV_AT, O_PHARM].forEach(function (c) { sh.getRange(row, c).clearContent(); });      // أوقات المراحل ترجع فاضية (الطلب بدأ من الأول)
  styleOrderRow_(sh, row);
  return { status: "success" };
}
// إلغاء الطلب: بيتشال من شيت "الطلبات" (زي ما الإدارة كانت بتمسح الصف يدويًا)، ومفيش رجوع فيه
function cancelOrder_(bon) {
  var sh = tab_(ORD_TAB); if (!sh) return { status: "error", message: "ورقة الطلبات غير موجودة" };
  var row = orderRow_(sh, bon); if (!row) return { status: "success" };      // اتشال قبل كده
  if (isTrue_(sh.getRange(row, O.DONE).getValue())) return { status: "error", message: "الطلب اتسلّم بالفعل" };
  sh.deleteRow(row);
  return { status: "success" };
}

// ===================== تعديل لوكيشن الطلب (محل / عميل) =====================
// نفس صيغ اللوكيشن اللي بيفهمها سكربت الطلبات (لينكات جوجل/Apple/Waze، geo:، إحداثيات، DMS، Plus Code)
var OLC_ = "23456789CFGHJMPQRVWX", STORE_COORDS = { lat: 30.121208, lng: 31.2491106 };
var UA_ = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
function inEgypt_(la, lo) { return isFinite(la) && isFinite(lo) && la >= 21 && la <= 33 && lo >= 24 && lo <= 37.5; }
function olcEncode_(lat, lng) {
  lat = Math.min(Math.max(lat, -90), 90) + 90; lng = ((lng + 180) % 360 + 360) % 360;
  var res = [20, 1, 0.05, 0.0025, 0.000125], out = "";
  for (var i = 0; i < 5; i++) { var a = Math.floor(lat / res[i]), b = Math.floor(lng / res[i]); lat -= a * res[i]; lng -= b * res[i]; out += OLC_.charAt(a) + OLC_.charAt(b); }
  return out.slice(0, 8) + "+" + out.slice(8);
}
function olcDecode_(code, ref) {
  code = String(code).toUpperCase().replace(/\s+/g, ""); var p = code.indexOf("+"); if (p < 0) return null;
  var full = code; if (p < 8) { if (!ref) return null; full = olcEncode_(ref.lat, ref.lng).slice(0, 8 - p) + code; }
  var d = full.replace("+", ""), res = [20, 1, 0.05, 0.0025, 0.000125], lat = -90, lng = -180, last = 0;
  for (var i = 0; i < Math.min(d.length, 10) / 2; i++) { var a = OLC_.indexOf(d.charAt(2 * i)), b = OLC_.indexOf(d.charAt(2 * i + 1)); if (a < 0 || b < 0) return null; lat += a * res[i]; lng += b * res[i]; last = res[i]; }
  return { lat: lat + last / 2, lng: lng + last / 2 };
}
function parseCoords_(t) {
  t = String(t || "").replace(/[٠-٩]/g, function (x) { return "٠١٢٣٤٥٦٧٨٩".indexOf(x); }).replace(/[۰-۹]/g, function (x) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(x); }).replace(/٫/g, ".").replace(/،/g, ",");
  var vs = [t]; try { var d = decodeURIComponent(t); if (d !== t) vs.push(d); } catch (e) {}
  var ok = function (la, ln) { la = +la; ln = +ln; return inEgypt_(la, ln) ? { lat: la, lng: ln } : null; };
  var pats = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&#](?:q|ll|query|destination|daddr|saddr|sll|center|coordinate|coord|latlng|dest|to)=(?:loc:|geo:)?\s*(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/i,
    /[?&](?:lat|latitude)=(-?\d{1,3}\.\d+)&(?:lng|lon|long|longitude)=(-?\d{1,3}\.\d+)/i,
    /geo:(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /\/(?:place|search|dir|maps|ll)\/(?:[^\/@?]*\/)?(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,3}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})\s*$/,
    /(?:^|[^\d.])(-?\d{1,3}\.\d{4,})\s*°?\s*N?\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})\s*°?\s*E?(?![\d.])/i
  ];
  for (var v = 0; v < vs.length; v++) {
    for (var i = 0; i < pats.length; i++) { var m = vs[v].match(pats[i]); var r = m && ok(m[1], m[2]); if (r) return r; }
    var m2 = vs[v].match(/!1d(-?\d{1,3}\.\d+)!2d(-?\d{1,3}\.\d+)/); var r2 = m2 && ok(m2[2], m2[1]); if (r2) return r2;
    var dm = vs[v].match(/(\d{1,2})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([NS])?[\s,;]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([EW])?/i);
    if (dm) { var la = +dm[1] + dm[2] / 60 + dm[3] / 3600, ln = +dm[5] + dm[6] / 60 + dm[7] / 3600; if (/s/i.test(dm[4] || "")) la = -la; if (/w/i.test(dm[8] || "")) ln = -ln; var r3 = ok(la, ln); if (r3) return r3; }
    var pc = vs[v].match(/(?:^|[\s(,:])((?:[23456789CFGHJMPQRVWX]{2,8})\+[23456789CFGHJMPQRVWX]{2,3})(?=$|[\s,)])/i);
    if (pc) { var o = olcDecode_(pc[1], STORE_COORDS); var r4 = o && ok(o.lat, o.lng); if (r4) return r4; }
  }
  return null;
}
function bodyCoords_(b) {
  var m = String(b).match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/) || String(b).match(/"latitude"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"longitude"\s*:\s*(-?\d{1,3}\.\d+)/) ||
    String(b).match(/itemprop="latitude"\s+content="(-?\d{1,3}\.\d+)"[^>]*itemprop="longitude"\s+content="(-?\d{1,3}\.\d+)"/) || String(b).match(/center=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/);
  return m && inEgypt_(+m[1], +m[2]) ? { lat: +m[1], lng: +m[2] } : null;
}
function resolveMapsLink_(url) {            // لينك مختصر ← بنمشي ورا التحويلات لحد ما نلاقي الإحداثيات
  var cur = url, res = null;
  for (var i = 0; i < 6 && cur; i++) {
    var pc = parseCoords_(cur); if (pc) { res = pc; break; }
    var r = UrlFetchApp.fetch(cur, { followRedirects: false, muteHttpExceptions: true, headers: { "User-Agent": UA_, "Accept-Language": "ar,en;q=0.8" } });
    var code = r.getResponseCode(), h = r.getHeaders() || {}, loc = h["Location"] || h["location"];
    if (code >= 300 && code < 400 && loc) { cur = /^https?:/i.test(loc) ? loc : (/^\//.test(loc) ? "https://www.google.com" + loc : loc); continue; }
    var body = String(r.getContentText() || "").slice(0, 400000), bc = bodyCoords_(body);
    if (bc) { res = bc; break; }
    var mm = body.match(/https?:\/\/(?:www\.)?google\.[a-z.]+\/maps[^"'<>\s\\]*/i), nx = mm ? mm[0].replace(/&amp;/g, "&") : "";
    if (nx && nx !== cur) { cur = nx; continue; }
    break;
  }
  return res;
}
function coordsOfLoc_(raw) {                // أي نص لوكيشن ← إحداثيات (أو null لو مش مفهوم)
  var s = txt_(raw, 700), u = s.match(/https?:\/\/[^\s]+/i), url = u ? u[0].replace(/[)\].,،;]+$/, "") : "";
  var c = parseCoords_(url || s); if (c) return c;
  if (url) { for (var k = 0; k < 2; k++) { try { var rr = resolveMapsLink_(url); if (rr) return rr; } catch (e) {} if (k === 0) Utilities.sleep(400); } }
  return null;
}
function resolveLocation_(loc) {
  var c = coordsOfLoc_(loc);
  return c ? { status: "success", lat: c.lat, lng: c.lng, link: "https://www.google.com/maps?q=" + c.lat + "," + c.lng } : { status: "error", message: "مقدرناش نفهم اللوكيشن ده (لازم يكون داخل مصر وبصيغة مفهومة)" };
}
function updateCustomerLoc_(phone, link) {
  var sh = tab_(CUS_TAB); if (!sh) return; var n = sh.getLastRow(); if (n < 2) return;
  var v = sh.getRange(2, C.PHONE, n - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (normPhone_(v[i][0]) === phone) { sh.getRange(i + 2, C.LOC).setValue(link); return; }
}
// نفس اللي بيحصل لما تغيّر الخلية بإيدك: بنكتب اللوكيشن، ونصفّر التوقيع (علشان مشغّل كل دقيقة في سكربت الطلبات يعيد حساب المسافة والتوصيل)، ونصفّر الوصول
function updateOrderLocation_(bon, which, loc) {
  if (which !== "shop" && which !== "cust") return { status: "error", message: "نوع اللوكيشن غير صحيح" };
  var sh = tab_(ORD_TAB); if (!sh) return { status: "error", message: "ورقة الطلبات غير موجودة" };
  var row = orderRow_(sh, bon); if (!row) return { status: "error", message: "الطلب غير موجود (يمكن اتسلّم أو اتلغى)" };
  var c = coordsOfLoc_(loc); if (!c) return { status: "error", message: "مقدرناش نفهم اللوكيشن ده" };
  var link = "https://www.google.com/maps?q=" + c.lat + "," + c.lng;
  sh.getRange(row, which === "shop" ? O.SLOC : O.CLOC).setValue(link);
  sh.getRange(row, O_SIG).clearContent();
  sh.getRange(row, O_ARR).clearContent(); sh.getRange(row, O.SHOP_ETA).setValue(""); sh.getRange(row, O.CUST_ETA).setValue("");
  if (which === "cust") updateCustomerLoc_(normPhone_(sh.getRange(row, O.PHONE).getDisplayValue()), link);
  return { status: "success", link: link };
}

// ===================== تجهيز ورقة الإدارة (شغّلها مرة) =====================
function setupManagerSheet() {
  var ss = ss_(), sh = ss.getSheetByName(ADMIN_TAB) || ss.insertSheet(ADMIN_TAB);
  sh.setRightToLeft(true);
  sh.getRange(1, 1, 1, 3).setValues([["الإصدار", "رابط التحديث", "حالة الخدمة"]]);
  if (!sh.getRange("A2").getValue()) sh.getRange("A2").setValue(APP_VERSION);
  if (!sh.getRange("C2").getValue()) sh.getRange("C2").setValue("متصل");
  sh.getRange(3, 1, 1, ADM.COLS).setValues([ADM_HEADERS]);
  [sh.getRange(1, 1, 1, 3), sh.getRange(3, 1, 1, ADM.COLS)].forEach(function (g) {
    g.setFontWeight("bold").setBackground("#111827").setFontColor("#E6C36A").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  });
  var rows = Math.max(sh.getMaxRows() - ADM.START + 1, 1);
  [ADM.PHONE, ADM.PASS, 6, 7, 10].forEach(function (c) { sh.getRange(ADM.START, c, rows, 1).setNumberFormat("@"); });
  sh.getRange(ADM.START, ADM.REQ, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(REQ_LIST, true).setAllowInvalid(false).build());
  sh.getRange(ADM.START, ADM.STATE, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATE_LIST, true).setAllowInvalid(false).build());
  [50, 170, 130, 110, 200, 150, 110, 90, 110, 160, 120].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  secret_();
  return "تم تجهيز ورقة " + ADMIN_TAB;
}
