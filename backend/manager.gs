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
var APP_VERSION = "1.0.0";
var LOGIN_MAX_FAILS = 8;
var ARCHIVE_LIMIT = 150;               // أقصى عدد طلبات مكتملة بتتعرض (الأحدث أولًا)

// ورقة الإدارة: صف 1 عناوين الإعدادات، صف 2 قيمها (A2 إصدار / B2 رابط تحديث / C2 حالة الخدمة)، صف 3 عناوين الجدول، والبيانات من صف 4
var ADM = { START: 4, COLS: 11, PHONE: 3, PASS: 4, REQ: 9, STATE: 11 };
var ADM_HEADERS = ["رقم", "الاسم", "رقم الهاتف", "الباسورد", "العنوان", "الرقم القومي", "تاريخ الميلاد", "السن الحالي", "حالة الطلب", "تاريخ ووقت الطلب", "حالة المسؤول"];

// أعمدة "الطيارين" (نفس تطبيق الطيار بالظبط)
var P = { NUM: 1, NAME: 2, PHONE: 3, PASS: 4, ADDR: 5, ID: 6, BIRTH: 7, AGE: 8, VEH: 9, REQ: 10, REQ_AT: 11, STATE: 12, SHIFT: 13, WALLET: 14, TOKEN: 15 };
var PIL_COLS = 15;
var VEHICLES = ["موتوسيكل", "عجلة كهربائية", "عجلة عادية", "سكوتر"];
var REQ_LIST = ["منتظر", "مقبول", "مرفوض"], STATE_LIST = ["يعمل", "موقوف مؤقتاً", "موقوف نهائي"];

// أعمدة "العملاء"
var C = { NUM: 1, NAME: 2, PHONE: 3, ADDR: 4, LOC: 5, DEALS: 6, STATUS: 7, PROG: 8, DEV: 9 };
var CUST_STATUS = ["جيد", "موقوف"], CUST_PROG = ["يعمل", "حذف"];

// أعمدة "الطلبات" / "الطلبات المكتملة" (نفس orders.gs)
var O = { NUM: 1, BON: 2, DATE: 3, TIME: 4, NAME: 5, PHONE: 6, AREA: 7, STREET: 8, LANDMARK: 9, CLOC: 10, DETAILS: 11, SLOC: 12, NOTE: 13, TOTAL: 14, RATE: 15,
  ACCEPT: 16, P1N: 17, P1P: 18, P2N: 19, P2P: 20, PNAME: 21, PPHONE: 22, SHOP_ETA: 23, PREP: 24, DELIV: 25, CUST_ETA: 26, DONE: 27, NOTIF: 28, STEPS: 29 };
var O_CID = 30, O_KM = 31, O_FEE = 32, O_GOODS = 33, O_SIG = 34, O_ARR = 35, A_AT = 36;

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

var WRITES_ = { updatePersonStatus: 1, updatePersonInfo: 1, updateCustomerStatus: 1, reassignPilot: 1 };
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents), a = d.action;
    if (a === "adminLogin") return out_(adminLogin_(d));
    if (a === "adminRegister") return out_(withLock_(function () { return adminRegister_(d); }));
    var bad = authed_(d); if (bad) return out_(bad);
    if (a === "adminStatus") return out_({ status: "active" });
    if (a === "getPeopleList") return out_({ status: "success", list: getPilots_(String(d.status || "")) });
    if (a === "getCustomers") return out_({ status: "success", list: getCustomers_() });
    if (a === "getOrdersForAdmin") return out_(getOrders_(String(d.phase || "new")));
    if (WRITES_[a]) return out_(withLock_(function () {
      if (a === "updatePersonStatus") return updatePilotStatus_(normPhone_(d.phone), d.requestStatus, d.personStatus);
      if (a === "updatePersonInfo") return updatePilotInfo_(normPhone_(d.originalPhone), d.fields || {});
      if (a === "updateCustomerStatus") return updateCustomer_(normPhone_(d.phone), d.status, d.prog);
      return reassignPilot_(d.bon, normPhone_(d.pilotPhone));
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
function getPilots_(filter) {
  var sh = tab_(PIL_TAB); if (!sh) return [];
  var last = pilotLast_(sh); if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, PIL_COLS).getDisplayValues(), out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], rq = String(r[P.REQ - 1]).trim();
    if (filter === "pending" && rq !== "منتظر") continue;
    if (filter === "accepted" && !isAcc_(rq)) continue;
    if (filter === "rejected" && rq !== "مرفوض") continue;
    out.push({ phone: normPhone_(r[P.PHONE - 1]) || r[P.PHONE - 1], name: r[P.NAME - 1], password: r[P.PASS - 1], address: r[P.ADDR - 1], idCard: r[P.ID - 1],
      birthDate: r[P.BIRTH - 1], age: r[P.AGE - 1], vehicle: r[P.VEH - 1], requestStatus: rq, assignDate: r[P.REQ_AT - 1], personStatus: String(r[P.STATE - 1]).trim(),
      shift: String(r[P.SHIFT - 1]).trim(), wallet: Number(r[P.WALLET - 1]) || 0 });
  }
  if (filter === "pending") out.reverse();
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
function orderObj_(rv, dv) {
  var goods = num_(rv[O_GOODS - 1]), fee = num_(rv[O_FEE - 1]);
  if (!isFinite(goods)) {                   // احتياطي: من نص "ح 1150 + ت 100 = ا 1250"
    var m = String(dv[O.TOTAL - 1]).match(/ح\s*([\d.]+)\s*\+\s*ت\s*([\d.]+)/);
    goods = m ? Number(m[1]) : (Number(String(dv[O.TOTAL - 1]).replace(/[^\d.]/g, "")) || 0); fee = m ? Number(m[2]) : 0;
  }
  if (!isFinite(fee)) fee = 0;
  var dash = function (a, b) { return String(a || "").trim() ? String(a).trim() + (String(b || "").trim() ? " - " + String(b).trim() : "") : ""; };
  return { bon: Number(rv[O.BON - 1]), date: dv[O.DATE - 1], time: dv[O.TIME - 1], name: dv[O.NAME - 1], phone: normPhone_(dv[O.PHONE - 1]), area: dv[O.AREA - 1], street: dv[O.STREET - 1],
    landmark: dv[O.LANDMARK - 1], cloc: String(dv[O.CLOC - 1] || "").trim(), details: dv[O.DETAILS - 1], note: dv[O.NOTE - 1],
    goods: goods, fee: fee, total: Math.round((goods + fee) * 100) / 100,
    accepted: isTrue_(rv[O.ACCEPT - 1]), prep: isTrue_(rv[O.PREP - 1]), deliv: isTrue_(rv[O.DELIV - 1]),
    pilotName: String(dv[O.PNAME - 1] || "").trim(), pilotPhone: normPhone_(dv[O.PPHONE - 1]),
    prev1: dash(dv[O.P1N - 1], dv[O.P1P - 1]), prev2: dash(dv[O.P2N - 1], dv[O.P2P - 1]),
    shopEta: String(dv[O.SHOP_ETA - 1] || "").trim(), custEta: String(dv[O.CUST_ETA - 1] || "").trim() };
}
function getOrders_(phase) {
  var ss = ss_(), list = [];
  if (phase === "delivered") {
    var arc = tab_(ARC_TAB); if (!arc || arc.getLastRow() < 2) return { status: "success", list: [] };
    var last = arc.getLastRow(), from = Math.max(2, last - ARCHIVE_LIMIT + 1), n = last - from + 1;
    var rg = arc.getRange(from, 1, n, A_AT), av = rg.getValues(), ad = rg.getDisplayValues();
    for (var a = av.length - 1; a >= 0; a--) {
      var o = orderObj_(av[a], ad[a]); if (isNaN(o.bon)) continue;
      var at = av[a][A_AT - 1]; o.archivedAt = at instanceof Date ? Utilities.formatDate(at, TZ, "dd/MM/yyyy hh:mm a") : String(ad[a][A_AT - 1] || "");
      list.push(o);
    }
    return { status: "success", list: list };
  }
  var sh = tab_(ORD_TAB); if (!sh) return { status: "success", list: [] };
  var lr = dataLast_(sh); if (lr < 2) return { status: "success", list: [] };
  var r2 = sh.getRange(2, 1, lr - 1, O_ARR), vals = r2.getValues(), disp = r2.getDisplayValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (vals[i][O.BON - 1] === "" || isTrue_(vals[i][O.DONE - 1])) continue;
    var ob = orderObj_(vals[i], disp[i]), ok = false;
    if (phase === "new") ok = !ob.accepted;
    else if (phase === "accepted") ok = ob.accepted && !ob.prep;
    else if (phase === "preparing") ok = ob.prep && !ob.deliv;
    else if (phase === "delivering") ok = ob.deliv;
    if (ok) list.push(ob);
  }
  var res = { status: "success", list: list };
  if (phase === "accepted") res.avail = availPilots_();
  return res;
}

// الطيارين المتاحين: مقبول + حالتهم يعمل + شيفتهم "يعمل الان" (نفس شروط قائمة الشيت)
function availPilots_() {
  return getPilots_("accepted").filter(function (p) { return p.personStatus === "يعمل" && p.shift === "يعمل الان"; })
    .map(function (p) { return { name: p.name, phone: p.phone, label: p.name + (p.vehicle ? " - " + p.vehicle : "") }; });
}
function pushPrev_(sh, r, name, phone) {    // نفس منطق تطبيق الطيار: السابق 1 ثم 2، وآخر اتنين بس
  name = String(name || "").trim(); if (!name) return;
  var rg = sh.getRange(r, O.P1N, 1, 4), v = rg.getValues()[0];
  if (!String(v[0]).trim() || String(v[0]).trim() === "--") { v[0] = name; v[1] = phone; }
  else if (!String(v[2]).trim() || String(v[2]).trim() === "--") { v[2] = name; v[3] = phone; }
  else { v[0] = v[2]; v[1] = v[3]; v[2] = name; v[3] = phone; }
  rg.setNumberFormat("@"); rg.setValues([[String(v[0]), String(v[1]), String(v[2]), String(v[3])]]);
}
function reassignPilot_(bon, pilotPhone) {
  var sh = tab_(ORD_TAB), pil = tab_(PIL_TAB);
  if (!sh || !pil) return { status: "error", message: "الورقة غير موجودة" };
  var lr = dataLast_(sh), row = 0;
  if (lr >= 2) { var b = sh.getRange(2, O.BON, lr - 1, 1).getValues(); for (var i = 0; i < b.length; i++) if (Number(b[i][0]) === Number(bon)) { row = i + 2; break; } }
  if (!row) return { status: "error", message: "الطلب غير موجود (يمكن اتسلّم أو اتلغى)" };
  var rv = sh.getRange(row, 1, 1, O_ARR).getValues()[0];
  if (!isTrue_(rv[O.ACCEPT - 1])) return { status: "error", message: "الطلب لسه ما اتقبلش من طيار" };
  if (isTrue_(rv[O.PREP - 1]) || isTrue_(rv[O.DELIV - 1])) return { status: "error", message: "مينفعش التحويل بعد بدء التجهيز" };
  var np = null, av = availPilots_();
  for (var k = 0; k < av.length; k++) if (av[k].phone === pilotPhone) np = av[k];
  if (!np) return { status: "error", message: "الطيار ده مش متاح دلوقتي (لازم مقبول + يعمل + شيفت يعمل الان)" };
  var oldPhone = normPhone_(rv[O.PPHONE - 1]);
  if (oldPhone === pilotPhone) return { status: "error", message: "الطلب معاه نفس الطيار بالفعل" };
  pushPrev_(sh, row, rv[O.PNAME - 1], oldPhone);          // الطيار القديم يتسجل "سابق"
  sh.getRange(row, O.PNAME).setValue(np.label);
  sh.getRange(row, O.PPHONE).setNumberFormat("@").setValue(np.phone);
  sh.getRange(row, O.SHOP_ETA).setValue(""); sh.getRange(row, O.CUST_ETA).setValue("");   // وصول الطيار القديم ميبقاش ظاهر للعميل
  return { status: "success" };
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
