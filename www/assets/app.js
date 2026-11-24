/* إدارة صيدلية عوف — لوحة الإدارة والمراقبة
   نفس تقسيمة "إدارة جبهالي": الإدارة والتعيين / متابعة الطيارين / متابعة الموظفين / متابعة المتعاقدين.
   كل الطلبات للسكربت POST + توكن المسؤول (السكربت بيتحقق منه في كل طلب). */
(function () {
  "use strict";
  var CFG = self.APP_CONFIG || {};
  var K_SESSION = "ouf_admin_session", K_DATA = "ouf_admin_full_data", K_TOKEN = "ouf_admin_token";
  var REQ_OPTIONS = ["منتظر", "مقبول", "مرفوض"];
  var PERSON_OPTIONS = ["يعمل", "موقوف مؤقتاً", "موقوف نهائي"];
  var VEHICLES = ["موتوسيكل", "عجلة كهربائية", "عجلة عادية", "سكوتر"];
  var CUST_STATUS = ["جيد", "موقوف"], CUST_PROG = ["يعمل", "حذف"];

  var S = {
    page: "management", mgmtTab: "pilots", mgmtSub: "pending", selected: null,
    draftReq: "", draftPerson: "", drafts: {}, orig: {}, editing: {}, search: "", custSearch: "",
    tpTab: "new", tpOrders: [], reassignBon: null, avail: [], msTab: "order",
    cache: {}, custCache: null, started: false, busy: false
  };

  /* ---------- أدوات ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { if (s === undefined || s === null) return ""; return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function toast(msg, type) {
    var w = $("toastWrap"); if (!w) return;
    var t = document.createElement("div"); t.className = "toast " + (type === "ok" ? "ok" : "err");
    t.innerHTML = '<i class="fa-solid ' + (type === "ok" ? "fa-circle-check" : "fa-circle-xmark") + '"></i><span>' + esc(msg) + "</span>";
    w.appendChild(t); setTimeout(function () { t.remove(); }, 3500);
  }
  // حارس ضد الضغط المتكرر: بيقفل الزرار ويعرض سبينر لحد ما الطلب يخلص
  function busyBtn(btn, label, fn) {
    if (!btn || btn.disabled) return;
    var html = btn.innerHTML; btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (label || "جارٍ الحفظ...");
    var restore = function () { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } };
    var p; try { p = fn(); } catch (e) { restore(); return; }
    if (p && p.then) p.then(restore, restore); else restore();
  }
  function getAdmin() { try { return JSON.parse(localStorage.getItem(K_DATA)) || {}; } catch (e) { return {}; } }
  function isAccepted(s) { return s === "مقبول" || s === "تم القبول"; }
  function mapsUrl(loc) {
    loc = String(loc || "").trim(); if (!loc) return "";
    if (/^https?:\/\//i.test(loc)) return loc;
    var m = loc.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    return m ? "https://www.google.com/maps?q=" + m[1] + "," + m[2] : "";
  }

  /* ---------- الاتصال بالسكربت ---------- */
  function post(action, data, authed) {
    if (!CFG.MANAGER_URL) { toast("رابط السكربت غير مضبوط في config.js", "err"); return Promise.reject(new Error("nourl")); }
    var body = { action: action };
    if (authed) { body.phone = getAdmin().phone; body.token = localStorage.getItem(K_TOKEN) || ""; }
    for (var k in (data || {})) body[k] = data[k];
    return fetch(CFG.MANAGER_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var d; try { d = JSON.parse(t); } catch (e) { throw new Error("bad"); }
        if (authed && d && d.status === "unauthorized") { forceLogout(); throw new Error("unauthorized"); }
        if (authed && d && (d.status === "suspended_temp" || d.status === "suspended_permanent")) { showSuspended(d.status === "suspended_temp" ? "تم إيقافك مؤقتًا" : "تم إيقافك بشكل دائم", d.message); throw new Error("suspended"); }
        return d;
      });
  }
  var api = function (a, d) { return post(a, d, true); };

  /* ---------- الدخول والتسجيل ---------- */
  function hasSession() { return !!(localStorage.getItem(K_SESSION) && localStorage.getItem(K_TOKEN)); }
  function forceLogout() { localStorage.removeItem(K_SESSION); localStorage.removeItem(K_DATA); localStorage.removeItem(K_TOKEN); location.reload(); }
  function showSuspended(title, msg) { $("suspTitle").textContent = title; $("suspMsg").textContent = msg || ""; $("suspendedScreen").style.display = "flex"; }
  function show(id, v) { $(id).style.display = v; }

  function doLogin(btn) {
    var phone = $("loginPhone").value.trim(), pass = $("loginPassword").value.trim();
    if (!phone || !pass) { toast("برجاء كتابة رقم الهاتف وكلمة المرور", "err"); return; }
    busyBtn(btn, "جاري التحقق...", function () {
      return post("adminLogin", { phone: phone, password: pass }, false).then(function (d) {
        if (d.status === "success") {
          localStorage.setItem(K_SESSION, d.name); localStorage.setItem(K_TOKEN, d.token);
          localStorage.setItem(K_DATA, JSON.stringify(d.personData || { name: d.name, phone: phone }));
          show("loginScreen", "none"); start();
        } else toast(d.message || "خطأ غير معروف", "err");
      }).catch(function (e) { if (e.message !== "nourl") toast("تعذر الاتصال بالسيرفر", "err"); });
    });
  }
  function calcAge() {
    var b = $("regBirthDate").value; if (!b) return;
    var bd = new Date(b), t = new Date(), a = t.getFullYear() - bd.getFullYear(), m = t.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < bd.getDate())) a--; $("regAge").value = a;
  }
  function doRegister(btn) {
    var v = function (id) { return $(id).value.trim(); };
    var f = { name: v("regName"), phone: v("regPhone"), password: v("regPassword"), address: v("regAddress"), idCard: v("regIdCard"), birthDate: v("regBirthDate"), age: v("regAge") };
    if (!f.name || !f.phone || !f.password || !f.address || !f.idCard || !f.birthDate) { toast("يرجى ملء جميع الحقول", "err"); return; }
    if (f.idCard.length !== 14) { toast("الرقم القومي يجب أن يكون 14 رقم", "err"); return; }
    busyBtn(btn, "جاري الإرسال...", function () {
      return post("adminRegister", f, false).then(function (d) {
        if (d.status === "success") { show("registerScreen", "none"); show("loginScreen", "flex"); toast("تم إرسال طلبك وهو الآن (منتظر)", "ok"); }
        else toast(d.message || "تعذر الإرسال", "err");
      }).catch(function (e) { if (e.message !== "nourl") toast("فشل إرسال البيانات", "err"); });
    });
  }

  /* ---------- القائمة الجانبية والتنقل ---------- */
  function drawerOpen() { return $("drawerPanel").classList.contains("open"); }
  function openDrawer() { $("drawerOverlay").classList.add("open"); $("drawerPanel").classList.add("open"); }
  function closeDrawer() { $("drawerOverlay").classList.remove("open"); $("drawerPanel").classList.remove("open"); }
  function openPage(p) {
    closeDrawer(); S.page = p; S.selected = null; S.reassignBon = null;
    document.querySelectorAll(".drawer-item").forEach(function (el) { el.classList.toggle("on", el.dataset.page === p); });
    renderPage(); window.scrollTo(0, 0);
  }
  function renderPage() {
    var sub = $("subNav"), main = $("mainContent");
    sub.style.display = "none"; main.className = "main";
    ({ profile: renderProfile, about: renderAbout, management: renderManagement, trackPilots: renderTrackPilots, monitorStaff: renderMonitorStaff, trackContractors: renderContractors })[S.page]();
  }
  function soon(title, icon, text) {
    return '<div class="tab-pane on tab-anim">' + (title ? '<div class="tab-head"><h2><i class="fa-solid ' + icon + '" style="margin-left:6px;color:var(--accent);"></i>' + title + "</h2></div>" : "") +
      '<div class="placeholder-soon"><i class="fa-solid fa-hourglass-half"></i><h2>قريبًا</h2><p>' + text + "</p></div></div>";
  }
  function chips(items, current, act) {
    return items.map(function (t) { return '<div class="sub-chip' + (current === t[0] ? " on" : "") + '" data-act="' + act + '" data-v="' + t[0] + '">' + t[1] + "</div>"; }).join("");
  }

  /* ---------- الإدارة والتعيين ---------- */
  var MGMT_TABS = [["pilots", "الطيارين"], ["staff", "الموظفين"], ["customers", "العملاء"], ["stores", "المحلات المتعاقدة"]];
  function renderManagement() {
    var sub = $("subNav"), main = $("mainContent"); sub.style.display = "flex"; main.className = "main with-sub";
    sub.innerHTML = chips(MGMT_TABS, S.mgmtTab, "mgmtTab");
    if (S.selected) { renderMgmtDetail(); return; }
    if (S.mgmtTab === "stores") { main.innerHTML = soon("", "", "هيتم تفعيل المحلات المتعاقدة هنا لاحقًا."); return; }
    if (S.mgmtTab === "staff") { main.innerHTML = soon("", "", "هيتم تفعيل تعيين الموظفين هنا لاحقًا."); return; }
    if (S.mgmtTab === "customers") { renderCustomersPage(); return; }
    var subs = [["pending", "طلبات التعيين"], ["accepted", "المعينين"], ["rejected", "المرفوضين"]];
    var h = '<div class="tab-pane on tab-anim"><div class="tab-head"><h2><i class="fa-solid fa-motorcycle" style="margin-left:6px;color:var(--accent);"></i>الطيارين</h2></div>';
    h += '<div style="display:flex;gap:8px;padding:0 6px;margin-bottom:14px;flex-wrap:wrap;">' + subs.map(function (t) {
      return '<button class="act-btn ' + (S.mgmtSub === t[0] ? "pri" : "sec") + '" style="width:auto;padding:9px 16px;font-size:12px;" data-act="mgmtSub" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" class="search-input" id="mgmtSearch" placeholder="ابحث بالاسم أو رقم الهاتف..." value="' + esc(S.search) + '"></div>';
    h += '<div id="mgmtListSlot"><div class="loader"><div class="spinner"></div></div></div></div>';
    main.innerHTML = h;
    renderMgmtList(); fetchPeople();
  }
  function fetchPeople() {
    var sub = S.mgmtSub, key = "pilots_" + sub;
    return api("getPeopleList", { type: "pilots", status: sub }).then(function (d) {
      S.cache[key] = Array.isArray(d.list) ? d.list : [];
      if (S.page === "management" && S.mgmtTab === "pilots" && S.mgmtSub === sub && !S.selected) renderMgmtList();
    }).catch(function () {
      var slot = $("mgmtListSlot");
      if (slot && !S.cache[key]) slot.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><h3>تعذر تحميل البيانات</h3></div>';
    });
  }
  function renderMgmtList() {
    var slot = $("mgmtListSlot"); if (!slot) return;
    var full = S.cache["pilots_" + S.mgmtSub];
    if (!full) return;
    var q = (S.search || "").trim().toLowerCase(), data = full;
    if (q) data = data.filter(function (p) { return (p.name || "").toLowerCase().indexOf(q) !== -1 || String(p.phone || "").indexOf(q) !== -1; });
    if (!data.length) { slot.innerHTML = '<div class="empty"><i class="fa-solid ' + (q ? "fa-magnifying-glass" : "fa-inbox") + '"></i><h3>' + (q ? "لا يوجد نتائج مطابقة للبحث" : "لا يوجد بيانات هنا") + "</h3></div>"; return; }
    var h = '<div class="dp-card">';
    data.forEach(function (p) {
      var cls, txt;
      if (S.mgmtSub === "accepted") {
        txt = p.personStatus || "—";
        cls = txt === "يعمل" ? "accepted" : (/مؤقت/.test(txt) ? "pending" : (/نهائي|دائم/.test(txt) ? "rejected" : "suspended"));
      } else { txt = p.requestStatus; cls = txt === "منتظر" ? "pending" : (txt === "مرفوض" ? "rejected" : "accepted"); }
      h += '<div class="dp-row" data-act="openPilot" data-id="' + esc(p.phone) + '"><i class="fa-solid fa-user ic"></i><div class="txt"><h4>' + esc(p.name) + "</h4><p>" + esc(p.phone) + '</p></div><span class="status-badge ' + cls + '">' + esc(txt) + '</span><i class="fa-solid fa-chevron-left" style="color:var(--dim);font-size:12px;margin-right:4px;"></i></div>';
    });
    slot.innerHTML = h + "</div>";
  }
  function openPilot(phone) {
    var list = S.cache["pilots_" + S.mgmtSub] || [], f = null;
    list.forEach(function (p) { if (String(p.phone) === String(phone)) f = p; });
    if (!f) return;
    S.selected = f; S.draftReq = f.requestStatus; S.draftPerson = f.personStatus;
    var keys = ["name", "phone", "password", "address", "idCard", "birthDate", "age", "vehicle", "assignDate"];
    S.drafts = {}; S.orig = {}; S.editing = {};
    keys.forEach(function (k) { S.drafts[k] = S.orig[k] = f[k] == null ? "" : String(f[k]); });
    renderPage(); window.scrollTo(0, 0);
  }
  function closeDetail() { S.selected = null; S.drafts = {}; S.orig = {}; S.editing = {}; renderPage(); }
  function editRow(key, icon, label, o) {
    o = o || {}; var editing = !!S.editing[key], val = S.drafts[key], disp = (val === undefined || val === null || val === "") ? "—" : val;
    var ltr = o.ltr ? ' dir="ltr" style="text-align:right;"' : "", v, a;
    if (editing) {
      if (o.select) v = '<select class="field-edit-input" data-model="' + key + '">' + o.select.map(function (x) { return '<option value="' + esc(x) + '"' + (x === val ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select>";
      else v = '<input type="text" class="field-edit-input"' + ltr + ' value="' + esc(val) + '" data-model="' + key + '">';
      a = '<i class="fa-solid fa-check edit-confirm" data-act="editOk" data-k="' + key + '"></i><i class="fa-solid fa-xmark edit-cancel" data-act="editNo" data-k="' + key + '"></i>';
    } else { v = "<p" + ltr + ">" + esc(disp) + (o.suffix || "") + "</p>"; a = '<i class="fa-solid fa-pen edit-pencil" data-act="editStart" data-k="' + key + '"></i>'; }
    return '<div class="dp-row edit-row"><i class="fa-solid ' + icon + ' ic"></i><div class="txt"><h4>' + label + "</h4>" + v + '</div><div class="edit-actions">' + a + "</div></div>";
  }
  function infoRow(icon, label, val) { return '<div class="dp-row edit-row"><i class="fa-solid ' + icon + ' ic"></i><div class="txt"><h4>' + label + "</h4><p>" + esc(val || "—") + "</p></div></div>"; }
  function renderMgmtDetail() {
    var p = S.selected, h = '<div class="tab-pane on"><div class="tab-head"><div style="display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-arrow-right" style="cursor:pointer;color:var(--accent);padding:6px;" data-act="closeDetail"></i><h2 style="font-size:15px;">' + esc(p.name) + "</h2></div></div>";
    h += '<div class="status-block"><div class="status-block-title">حالة الطلب</div><div class="status-choice-group">' + REQ_OPTIONS.map(function (o) { return '<button type="button" class="status-choice-btn' + (S.draftReq === o ? " on" : "") + '" data-act="draftReq" data-v="' + o + '">' + o + "</button>"; }).join("") + "</div></div>";
    h += '<div class="status-block"><div class="status-block-title">حالة الطيار</div><div class="status-choice-group">' + PERSON_OPTIONS.map(function (o) { return '<button type="button" class="status-choice-btn' + (S.draftPerson === o ? " on" : "") + '" data-act="draftPerson" data-v="' + o + '">' + o + "</button>"; }).join("") + '</div><button class="act-btn pri" style="margin-top:6px;" data-act="saveStatus"><i class="fa-solid fa-check"></i> تأكيد الحالة</button></div>';
    h += '<div class="detail-divider"></div><div class="dp-card">';
    h += editRow("name", "fa-user", "الاسم") + editRow("phone", "fa-phone", "رقم الهاتف", { ltr: true }) + editRow("password", "fa-lock", "كلمة المرور") + editRow("address", "fa-map-location-dot", "العنوان");
    h += editRow("idCard", "fa-id-card", "الرقم القومي", { ltr: true }) + editRow("birthDate", "fa-calendar-days", "تاريخ الميلاد") + editRow("age", "fa-cake-candles", "السن", { suffix: " سنة" });
    h += editRow("vehicle", "fa-motorcycle", "المركبة", { select: VEHICLES.indexOf(S.drafts.vehicle) < 0 && S.drafts.vehicle ? [S.drafts.vehicle].concat(VEHICLES) : VEHICLES }) + editRow("assignDate", "fa-clock", "تاريخ التعيين");
    h += infoRow("fa-user-clock", "الشيفت الحالي", p.shift) + infoRow("fa-wallet", "المحفظة", (p.wallet || 0) + " ج");
    h += '</div><div class="save-changes-wrap"><button class="act-btn save-btn" data-act="saveInfo"><i class="fa-solid fa-floppy-disk"></i> حفظ التغييرات</button></div></div>';
    $("mainContent").innerHTML = h;
  }
  function saveInfo(btn) {
    var p = S.selected; if (!p) return;
    busyBtn(btn, "جارٍ حفظ البيانات...", function () {
      return api("updatePersonInfo", { type: "pilots", originalPhone: p.phone, fields: S.drafts }).then(function (d) {
        if (d && d.status === "success") {
          for (var k in S.drafts) p[k] = S.drafts[k];
          S.orig = JSON.parse(JSON.stringify(S.drafts)); S.editing = {};
          toast("تم حفظ التعديلات", "ok"); renderPage(); fetchPeople();
        } else toast((d && d.message) || "تعذر حفظ التعديلات", "err");
      }).catch(netErr);
    });
  }
  function saveStatus(btn) {
    var p = S.selected; if (!p) return;
    busyBtn(btn, "جارٍ حفظ الحالة...", function () {
      return api("updatePersonStatus", { type: "pilots", phone: p.phone, requestStatus: S.draftReq, personStatus: S.draftPerson }).then(function (d) {
        if (d && d.status === "success") { toast("تم تحديث الحالة", "ok"); delete S.cache.pilots_pending; delete S.cache.pilots_accepted; delete S.cache.pilots_rejected; closeDetail(); }
        else toast((d && d.message) || "تعذر الحفظ", "err");
      }).catch(netErr);
    });
  }
  function netErr(e) { if (e && ["unauthorized", "suspended", "nourl"].indexOf(e.message) < 0) toast("تعذر الاتصال بالسيرفر", "err"); }

  /* ---------- العملاء ---------- */
  function renderCustomersPage() {
    $("mainContent").innerHTML = '<div class="tab-pane on tab-anim"><div class="tab-head"><h2><i class="fa-solid fa-users" style="margin-left:6px;color:var(--accent);"></i>العملاء</h2><div class="tab-badge" id="custBadge">0</div></div>' +
      '<div class="search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" class="search-input" id="custSearch" placeholder="ابحث بالاسم أو رقم الهاتف..." value="' + esc(S.custSearch) + '"></div><div id="custListSlot"><div class="loader"><div class="spinner"></div></div></div></div>';
    renderCustList(); fetchCustomers();
  }
  function fetchCustomers() {
    return api("getCustomers").then(function (d) {
      S.custCache = Array.isArray(d.list) ? d.list : [];
      if (S.page === "management" && S.mgmtTab === "customers" && !S.selected) renderCustList();
    }).catch(function () { var s = $("custListSlot"); if (s && !S.custCache) s.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><h3>تعذر تحميل العملاء</h3></div>'; });
  }
  function custBad(c) { return /موقوف|محظور|حظر/.test(c.status || "") || /حذف/.test(c.prog || ""); }
  function renderCustList() {
    var slot = $("custListSlot"); if (!slot || !S.custCache) return;
    var full = S.custCache, b = $("custBadge"); if (b) b.textContent = full.length;
    var q = (S.custSearch || "").trim().toLowerCase(), data = full;
    if (q) data = data.filter(function (c) { return (c.name || "").toLowerCase().indexOf(q) !== -1 || String(c.phone || "").indexOf(q) !== -1; });
    if (!data.length) { slot.innerHTML = '<div class="empty"><i class="fa-solid ' + (q ? "fa-magnifying-glass" : "fa-user-slash") + '"></i><h3>' + (q ? "لا يوجد نتائج مطابقة للبحث" : "لا يوجد عملاء مسجلين بعد") + "</h3></div>"; return; }
    var h = '<div class="dp-card">';
    data.forEach(function (c) {
      var bad = custBad(c), label = /حذف/.test(c.prog || "") ? "حذف" : (c.status || "جيد");
      h += '<div class="dp-row" data-act="openCust" data-id="' + esc(c.phone) + '"><i class="fa-solid fa-user ic"></i><div class="txt"><h4>' + esc(c.name) + "</h4><p>" + esc(c.phone) + '</p></div><span class="status-badge ' + (bad ? "rejected" : "accepted") + '">' + esc(label) + '</span><i class="fa-solid fa-chevron-left" style="color:var(--dim);font-size:12px;margin-right:4px;"></i></div>';
    });
    slot.innerHTML = h + "</div>";
  }
  function openCust(phone) {
    var c = null; (S.custCache || []).forEach(function (x) { if (String(x.phone) === String(phone)) c = x; });
    if (!c) return;
    var url = mapsUrl(c.location), grp = function (title, items, cur, kind) {
      return '<div class="status-block-title" style="margin:0 6px 8px;">' + title + '</div><div class="status-choice-group" style="padding:0 6px;">' + items.map(function (o) {
        return '<button type="button" class="status-choice-btn' + (cur === o ? " on" : "") + '" data-act="custSet" data-kind="' + kind + '" data-phone="' + esc(c.phone) + '" data-v="' + o + '">' + o + "</button>";
      }).join("") + "</div>";
    };
    $("modalBox").innerHTML = '<div class="modal-bar"></div><div class="modal-ttl">' + esc(c.name) + "</div>" +
      '<div class="status-block" style="margin:0 0 12px;"><div class="status-block-title">بيانات العميل</div><div class="cust-meta">الهاتف: ' + esc(c.phone) + "\nالتعاملات: " + esc(c.deals === "" ? "0" : c.deals) + "\n" + esc(c.address || "—") + "</div>" +
      (url ? '<a class="loc-btn" href="' + esc(url) + '" target="_blank" rel="noopener"><i class="fa-solid fa-location-dot"></i> لوكيشن العميل</a>' : "") + "</div>" +
      grp("حالة العميل", CUST_STATUS, c.status, "status") + grp("حالة البرنامج (حذف = إلغاء تثبيت التطبيق من جهاز العميل)", CUST_PROG, c.prog, "prog") +
      '<div class="modal-btns"><button class="act-btn sec" style="flex:1;" data-act="closeModal">إغلاق</button></div>';
    $("modalBg").classList.add("show");
  }
  function custSet(btn) {
    var phone = btn.dataset.phone, kind = btn.dataset.kind, v = btn.dataset.v;
    var run = function () {
      busyBtn(btn, "...", function () {
        var data = { phone: phone }; data[kind] = v;
        return api("updateCustomerStatus", data).then(function (d) {
          if (d && d.status === "success") { toast("تم تحديث حالة العميل", "ok"); closeModal(); fetchCustomers(); } else toast((d && d.message) || "تعذر الحفظ", "err");
        }).catch(netErr);
      });
    };
    if (v === "موقوف" || v === "حذف") confirmBox(v === "حذف" ? "سيتم إلغاء تثبيت التطبيق من جهاز العميل وقفله. متأكد؟" : "سيتم حظر العميل من استخدام التطبيق. متأكد؟", run);
    else run();
  }
  function confirmBox(text, onYes) {
    window.__confirmYes = onYes;
    $("modalBox").innerHTML = '<div class="modal-bar"></div><div class="cfm-icon dan"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="cfm-txt">' + esc(text) + '</div><div class="modal-btns"><button class="act-btn dan" style="flex:1;" data-act="confirmYes">تأكيد</button><button class="act-btn sec" style="flex:1;" data-act="closeModal">إلغاء</button></div>';
    $("modalBg").classList.add("show");
  }
  function closeModal() { $("modalBg").classList.remove("show"); }

  /* ---------- متابعة الطيارين ---------- */
  var TP_TABS = [["new", "جديدة"], ["accepted", "مقبولة"], ["preparing", "تجهيز"], ["delivering", "توصيل"], ["delivered", "تم التسليم"]];
  var TP_LABELS = { "new": "الطلبات الجديدة", accepted: "الطلبات المقبولة", preparing: "قيد التحضير", delivering: "قيد التوصيل", delivered: "تم التسليم" };
  function renderTrackPilots() {
    var sub = $("subNav"); sub.style.display = "flex"; $("mainContent").className = "main with-sub";
    sub.innerHTML = chips(TP_TABS, S.tpTab, "tpTab");
    $("mainContent").innerHTML = '<div class="tab-pane on tab-anim"><div class="loader"><div class="spinner"></div></div></div>';
    S.tpSig = ""; fetchOrders();
  }
  function fetchOrders() {
    var tab = S.tpTab;
    return api("getOrdersForAdmin", { phase: tab }).then(function (d) {
      if (S.page !== "trackPilots" || S.tpTab !== tab) return;
      var list = Array.isArray(d.list) ? d.list : [], sig = tab + JSON.stringify(list);
      S.avail = d.avail || S.avail;
      if (sig === S.tpSig) return;                       // مفيش تغيير: متعملش إعادة رسم
      S.tpSig = sig; S.tpOrders = list; renderOrders();
    }).catch(function () {
      if (S.page === "trackPilots" && !S.tpSig) $("mainContent").innerHTML = '<div class="tab-pane on"><div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><h3>تعذر تحميل الطلبات</h3></div></div>';
    });
  }
  function renderOrders() {
    var y = window.scrollY, h = '<div class="tab-pane on"><div class="tab-head"><h2>' + TP_LABELS[S.tpTab] + '</h2><div class="tab-badge">' + S.tpOrders.length + "</div></div>";
    if (!S.tpOrders.length) h += '<div class="empty"><i class="fa-solid fa-inbox"></i><h3>لا توجد طلبات هنا</h3></div>';
    else S.tpOrders.forEach(function (o) { h += orderCard(o); });
    $("mainContent").innerHTML = h + "</div>"; window.scrollTo(0, y);
  }
  function orderCard(o) {
    var addr = []; if (o.area) addr.push("المنطقة: " + o.area); if (o.street) addr.push("الشارع: " + o.street);
    var url = mapsUrl(o.cloc);
    var h = '<div class="ocard"><div class="oc-hdr"><span class="oc-bon"><i class="fa-solid fa-receipt"></i> بون: ' + esc(o.bon) + '</span><span class="oc-badge">' + esc(((o.date || "") + " " + (o.time || "")).trim()) + '</span></div><div class="oc-body">';
    h += '<div class="oc-name-row"><span class="oc-name-text"><i class="fa-solid fa-user" style="color:var(--accent);margin-left:5px;"></i>' + esc(o.name || "—") + '</span><a class="oc-phone-btn" href="tel:' + esc(o.phone) + '"><i class="fa-solid fa-phone"></i></a></div>';
    if (addr.length) h += '<div class="oc-addr">' + esc(addr.join(" / ")) + (o.landmark ? ' <span style="color:var(--accent);">(علامة: ' + esc(o.landmark) + ")</span>" : "") + "</div>";
    if (url) h += '<a class="loc-btn" href="' + esc(url) + '" target="_blank" rel="noopener"><i class="fa-solid fa-location-dot"></i> لوكيشن العميل</a>';
    if (o.details) h += '<div class="oc-details-box">' + esc(o.details) + "</div>";
    if (o.note) h += '<div class="oc-addr" style="margin-top:6px;">ملحوظة: ' + esc(o.note) + "</div>";
    h += '<div class="oc-addr" style="margin-top:6px;">حساب العميل: ' + esc(o.goods) + " ج / التوصيل: " + esc(o.fee) + " ج / الإجمالي: <b style=\"color:var(--accent);\">" + esc(o.total) + " ج</b></div>";
    if (o.pilotName) {
      h += '<div class="pilot-header"><span style="font-size:12.5px;font-weight:800;"><i class="fa-solid fa-motorcycle" style="color:var(--accent);margin-left:5px;"></i>الطيار: ' + esc(o.pilotName) + '</span><a class="oc-phone-btn" href="tel:' + esc(o.pilotPhone) + '"><i class="fa-solid fa-phone"></i></a></div>';
      if (o.shopEta && S.tpTab !== "delivered") h += '<div class="eta-line"><i class="fa-solid fa-store"></i> الوصول للمحل خلال: ' + esc(o.shopEta) + "</div>";
      if (o.custEta && S.tpTab !== "delivered") h += '<div class="eta-line"><i class="fa-solid fa-house"></i> الوصول للعميل خلال: ' + esc(o.custEta) + "</div>";
    }
    var prev = []; if (o.prev1 && o.prev1 !== "--") prev.push(o.prev1); if (o.prev2 && o.prev2 !== "--") prev.push(o.prev2);
    if (prev.length) h += '<div class="prev-line"><i class="fa-solid fa-clock-rotate-left"></i> طيارين سابقين: ' + esc(prev.join(" ، ")) + "</div>";
    if (o.archivedAt) h += '<div class="prev-line"><i class="fa-solid fa-circle-check"></i> وقت التسليم: ' + esc(o.archivedAt) + "</div>";
    if (S.tpTab === "accepted") {
      if (S.reassignBon === o.bon) {
        var opts = (S.avail || []).filter(function (p) { return p.phone !== o.pilotPhone; });
        h += '<div class="reassign-box">' + (opts.length ? '<select id="reassignSel"><option value="">اختر الطيار الجديد...</option>' + opts.map(function (p) { return '<option value="' + esc(p.phone) + '">' + esc(p.label) + "</option>"; }).join("") + '</select><button class="act-btn pri" style="font-size:12px;padding:10px;" data-act="doReassign" data-bon="' + esc(o.bon) + '"><i class="fa-solid fa-right-left"></i> تأكيد التحويل</button>'
          : '<div class="oc-addr">لا يوجد طيار متاح (يعمل الان) غير الطيار الحالي.</div>') + '<button class="act-btn sec" style="font-size:12px;padding:10px;margin-top:8px;" data-act="reassignCancel">إلغاء</button></div>';
      } else h += '<button class="act-btn sec" style="margin-top:8px;font-size:12px;" data-act="reassignOpen" data-bon="' + esc(o.bon) + '"><i class="fa-solid fa-right-left"></i> تحويل لطيار آخر</button>';
    }
    return h + "</div></div>";
  }
  function doReassign(btn) {
    var bon = btn.dataset.bon, sel = $("reassignSel"), phone = sel && sel.value;
    if (!phone) { toast("اختر الطيار الجديد", "err"); return; }
    busyBtn(btn, "جارٍ التحويل...", function () {
      return api("reassignPilot", { bon: bon, pilotPhone: phone }).then(function (d) {
        if (d && d.status === "success") { toast("تم تحويل الطلب بنجاح", "ok"); S.reassignBon = null; S.tpSig = ""; return fetchOrders(); }
        toast((d && d.message) || "تعذر التحويل", "err");
      }).catch(netErr);
    });
  }

  /* ---------- متابعة الموظفين / المتعاقدين (قريبًا) ---------- */
  var MS_TABS = [["order", "دعم الطلبات"], ["personal", "دعم شخصي"], ["customers", "دعم العملاء"], ["contractors", "دعم المتعاقدين"]];
  var MS_TITLES = { order: "دعم الطلبات", personal: "دعم شخصي", customers: "دعم العملاء", contractors: "دعم المتعاقدين" };
  function renderMonitorStaff() {
    var sub = $("subNav"); sub.style.display = "flex"; $("mainContent").className = "main with-sub";
    sub.innerHTML = chips(MS_TABS, S.msTab, "msTab");
    $("mainContent").innerHTML = soon(MS_TITLES[S.msTab], "fa-headset", "هيتم تفعيل " + MS_TITLES[S.msTab] + " هنا لاحقًا بعد تجهيز نظام موظفي الدعم.");
  }
  function renderContractors() { $("mainContent").innerHTML = soon("متابعة المتعاقدين", "fa-handshake", "هيتم تفعيل متابعة المتعاقدين هنا لاحقًا مع تصميم قسم المحلات المتعاقدة."); }

  /* ---------- الصفحة الشخصية / حول ---------- */
  function renderProfile() {
    var p = getAdmin();
    $("mainContent").innerHTML = '<div class="tab-pane on"><div class="tab-head"><h2><i class="fa-solid fa-user-gear" style="margin-left:6px;color:var(--accent);"></i>الصفحة الشخصية</h2></div>' +
      '<div class="dp-card"><div class="dp-top"><div class="dp-avatar"></div><div class="dp-name">' + esc(p.name || "—") + '</div><div class="dp-role">مسؤول إداري - صيدلية عوف</div></div></div>' +
      '<div class="dp-card">' + infoRow("fa-phone", "رقم الهاتف", p.phone) + infoRow("fa-map-location-dot", "العنوان", p.address) + infoRow("fa-id-card", "الرقم القومي", p.idCard) + "</div>" +
      '<button class="end-shift-btn" data-act="logout" style="margin-top:16px;"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</button></div>';
  }
  function renderAbout() {
    $("mainContent").innerHTML = '<div class="tab-pane on"><div class="dp-card"><div class="dp-top"><div class="dp-avatar"></div><div class="dp-name" style="color:var(--accent);">إدارة صيدلية عوف</div><div class="dp-role">لوحة الإدارة والمراقبة الشاملة</div></div></div>' +
      '<div class="dp-card" style="padding:20px;text-align:center;"><span style="font-size:14px;font-weight:900;color:var(--accent);">الإصدار v' + esc(CFG.APP_VERSION || "1.0.0") + "</span></div></div>";
  }

  /* ---------- التحديث الدوري ---------- */
  function refresh() {
    $("syncDot").className = "sync-dot"; $("syncTxt").textContent = "متصل";
    if (S.page === "management" && !S.selected) { if (S.mgmtTab === "customers") return fetchCustomers(); if (S.mgmtTab === "pilots") return fetchPeople(); }
    if (S.page === "trackPilots" && S.reassignBon === null) return fetchOrders();
    return Promise.resolve();
  }
  function manualRefresh() {
    var b = $("refBtn"); b.classList.add("spin");
    if (S.page === "trackPilots") S.tpSig = "";
    refresh().then(function () { b.classList.remove("spin"); }, function () { b.classList.remove("spin"); });
  }
  function checkStatus() { return api("adminStatus").catch(function () {}); }   // بيرجع suspended/unauthorized فبيتعامل معاه post()

  function start() {
    if (S.started) return; S.started = true;
    $("drawerFooterVersion").textContent = "إدارة صيدلية عوف v" + (CFG.APP_VERSION || "1.0.0");
    document.querySelectorAll(".drawer-item").forEach(function (el) { el.classList.toggle("on", el.dataset.page === S.page); });
    renderPage(); checkStatus();
    setInterval(function () { if (document.hidden) return; if (S.busy) return; S.busy = true; refresh().then(function () { S.busy = false; }, function () { S.busy = false; }); }, CFG.POLL_MS || 10000);
    setInterval(function () { if (!document.hidden) checkStatus(); }, 30000);
  }

  /* ---------- زرار الرجوع (أندرويد) ---------- */
  function goBack() {
    if ($("modalBg").classList.contains("show")) return closeModal();
    if (drawerOpen()) return closeDrawer();
    if (S.selected) return closeDetail();
    if (S.reassignBon !== null) { S.reassignBon = null; return renderOrders(); }
    if (S.page !== "management") return openPage("management");
    confirmBox("هل تريد الخروج من التطبيق؟", function () { try { window.Capacitor.Plugins.App.exitApp(); } catch (e) {} });
  }

  /* ---------- الأحداث (تفويض) ---------- */
  var ACT = {
    togglePw: function (el) { var i = $(el.dataset.target); var show = i.type === "password"; i.type = show ? "text" : "password"; el.innerHTML = '<i class="fa-solid ' + (show ? "fa-eye-slash" : "fa-eye") + '"></i>'; },
    login: doLogin, register: doRegister,
    showRegister: function () { show("loginScreen", "none"); show("registerScreen", "flex"); },
    showLogin: function () { show("registerScreen", "none"); show("loginScreen", "flex"); },
    logout: forceLogout, openDrawer: openDrawer, closeDrawer: closeDrawer, refresh: manualRefresh,
    page: function (el) { openPage(el.dataset.page); },
    modalBg: function (el, e) { if (e.target === el) closeModal(); }, closeModal: closeModal,
    confirmYes: function () { var f = window.__confirmYes; window.__confirmYes = null; closeModal(); if (f) f(); },
    mgmtTab: function (el) { S.mgmtTab = el.dataset.v; S.mgmtSub = "pending"; S.selected = null; S.search = ""; renderManagement(); },
    mgmtSub: function (el) { S.mgmtSub = el.dataset.v; S.selected = null; renderManagement(); },
    openPilot: function (el) { openPilot(el.dataset.id); }, closeDetail: closeDetail,
    draftReq: function (el) { S.draftReq = el.dataset.v; renderPage(); }, draftPerson: function (el) { S.draftPerson = el.dataset.v; renderPage(); },
    saveStatus: saveStatus, saveInfo: saveInfo,
    editStart: function (el) { S.editing[el.dataset.k] = true; renderPage(); },
    editOk: function (el) { S.editing[el.dataset.k] = false; renderPage(); },
    editNo: function (el) { S.drafts[el.dataset.k] = S.orig[el.dataset.k]; S.editing[el.dataset.k] = false; renderPage(); },
    openCust: function (el) { openCust(el.dataset.id); }, custSet: custSet,
    tpTab: function (el) { S.tpTab = el.dataset.v; S.reassignBon = null; renderTrackPilots(); },
    reassignOpen: function (el) { S.reassignBon = Number(el.dataset.bon); renderOrders(); },
    reassignCancel: function () { S.reassignBon = null; renderOrders(); }, doReassign: doReassign,
    msTab: function (el) { S.msTab = el.dataset.v; renderMonitorStaff(); }
  };
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.model) S.drafts[t.dataset.model] = t.value;
    else if (t.id === "mgmtSearch") { S.search = t.value; renderMgmtList(); }
    else if (t.id === "custSearch") { S.custSearch = t.value; renderCustList(); }
    else if (t.id === "regBirthDate") calcAge();
  });
  document.addEventListener("change", function (e) { if (e.target.id === "regBirthDate") calcAge(); if (e.target.dataset && e.target.dataset.model) S.drafts[e.target.dataset.model] = e.target.value; });

  document.addEventListener("DOMContentLoaded", function () {
    if (!CFG.MANAGER_URL) $("cfgWarn").hidden = false;
    try { var A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; if (A && A.addListener) A.addListener("backButton", goBack); } catch (e) {}
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) navigator.serviceWorker.register("sw.js").catch(function () {});
    if (hasSession()) { show("loginScreen", "none"); start(); }
  });
})();
