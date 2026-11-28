/* إدارة صيدلية عوف — لوحة الإدارة والمراقبة
   - كل التعديلات لحظية في الشاشة، وبتتبعت للسيرفر في الخلفية (طابور). علامة الواي فاي جنب القائمة بتبين الحالة:
     أخضر = كله متزامن | أصفر (شرطتين) = في تعديلات لسه بتتبعت | أصفر كامل = النت ضعيف | أحمر = فاصل. */
(function () {
  "use strict";
  var CFG = self.APP_CONFIG || {};
  var K_SESSION = "ouf_admin_session", K_DATA = "ouf_admin_full_data", K_TOKEN = "ouf_admin_token";
  var REQ_OPTIONS = ["منتظر", "مقبول", "مرفوض"];
  var PERSON_OPTIONS = ["يعمل", "موقوف مؤقتاً", "موقوف نهائي"];
  var VEHICLES = ["موتوسيكل", "عجلة كهربائية", "عجلة عادية", "سكوتر"];
  var CUST_STATUS = ["جيد", "موقوف"], CUST_PROG = ["يعمل", "حذف"];
  var STAGE_TAG = { "new": "جديد", accepted: "تم القبول", preparing: "جاري التحضير", delivering: "جاري التوصيل", delivered: "تم التسليم" };

  var S = {
    page: "management", mgmtTab: "pilots", mgmtSub: "pending", custSub: "ok", selected: null,
    draftReq: "", draftPerson: "", drafts: {}, orig: {}, editing: {}, search: "", custSearch: "",
    tpTab: "working", msTab: "order", viewPilot: null, pwShown: false,
    pilots: null, custs: null, orders: null, delivered: null, sig: {}, lastSync: Date.now(),
    open: null, inv: {}, pickBon: null, pickType: "fuel", pickSel: null,
    online: true, weak: 0, queue: [], flushing: false, failN: 0, wseq: 0, started: false, polling: false
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
  function busyBtn(btn, label, fn) {
    if (!btn || btn.disabled) return;
    var html = btn.innerHTML; btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (label || "جارٍ الحفظ...");
    var restore = function () { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } };
    var p; try { p = fn(); } catch (e) { restore(); return; }
    if (p && p.then) p.then(restore, restore); else restore();
  }
  function getAdmin() { try { return JSON.parse(localStorage.getItem(K_DATA)) || {}; } catch (e) { return {}; } }
  function isAcc(s) { return s === "مقبول" || s === "تم القبول"; }
  function mapsUrl(loc) {
    loc = String(loc || "").trim(); if (!loc) return "";
    if (/^https?:\/\//i.test(loc)) return loc;
    var m = loc.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    return m ? "https://www.google.com/maps?q=" + m[1] + "," + m[2] : "";
  }
  var waUrl = function (ph) { return "https://wa.me/2" + String(ph || "").replace(/^0/, ""); };
  var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  function nowStr() { var d = new Date(), h = d.getHours(), ap = h < 12 ? "AM" : "PM"; return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p2(h % 12 || 12) + ":" + p2(d.getMinutes()) + " " + ap; }
  function fmtDur(m) { if (m < 0) return "—"; if (m < 1) return "أقل من دقيقة"; if (m < 60) return m + " دقيقة"; var h = Math.floor(m / 60), r = m % 60; return h + " ساعة" + (r ? " و " + r + " دقيقة" : ""); }
  function splitLabel(l) { l = String(l || "").trim(); var i = l.lastIndexOf(" - "); return i < 0 ? { name: l, veh: "" } : { name: l.slice(0, i).trim(), veh: l.slice(i + 3).trim() }; }

  /* ---------- علامة الشبكة ---------- */
  function netState() {
    var n = S.queue.length;
    if (!S.online) return { k: "off", n: n };
    if (n) return { k: "chk", n: n };
    if (S.weak > Date.now()) return { k: "warn", n: 0 };
    return { k: "ok", n: 0 };
  }
  function wifiIcon(k) {
    var X = k === "off" ? '<circle cx="18" cy="18" r="5" class="wx"/><path d="M16 16l4 4M20 16l-4 4" stroke="#fff" stroke-width="2"/>' : "";
    return '<svg viewBox="0 0 24 24" class="wf wf-' + k + '" aria-hidden="true"><path class="w3" d="M2 9a15 15 0 0 1 20 0"/><path class="w2" d="M5 12.5a10 10 0 0 1 14 0"/><path class="w1" d="M8.5 16a5 5 0 0 1 7 0"/><path class="w0" d="M12 19.5h.01"/>' + X + "</svg>";
  }
  function renderNet() {
    var b = $("netBtn"); if (!b) return; var ns = netState();
    b.className = "netb " + ns.k; b.innerHTML = wifiIcon(ns.k) + (ns.n ? '<i class="nb-c">' + ns.n + "</i>" : "");
  }
  function netInfo() {
    var ns = netState();
    if (ns.k === "off") toast("مفيش اتصال بالنت" + (ns.n ? " — " + ns.n + " تعديل مستني" : ""), "err");
    else if (ns.k === "chk") toast("جاري إرسال " + ns.n + " تعديل للسيرفر...", "ok");
    else if (ns.k === "warn") toast("النت ضعيف", "err");
    else toast("كل البيانات متزامنة ✅", "ok");
    if (S.queue.length) pump();
  }

  /* ---------- الاتصال بالسكربت ---------- */
  function post(action, data, authed) {
    if (!CFG.MANAGER_URL) { toast("رابط السكربت غير مضبوط في config.js", "err"); return Promise.reject(new Error("nourl")); }
    var body = { action: action }, t0 = Date.now();
    if (authed) { body.phone = getAdmin().phone; body.token = localStorage.getItem(K_TOKEN) || ""; }
    for (var k in (data || {})) body[k] = data[k];
    return fetch(CFG.MANAGER_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var d; try { d = JSON.parse(t); } catch (e) { S.online = false; renderNet(); throw new Error("net"); }
        S.online = true; if (Date.now() - t0 > 8000) S.weak = Date.now() + 40000; renderNet();
        if (authed && d && d.status === "unauthorized") { forceLogout(); throw new Error("unauthorized"); }
        if (authed && d && (d.status === "suspended_temp" || d.status === "suspended_permanent")) { showSuspended(d.status === "suspended_temp" ? "تم إيقافك مؤقتًا" : "تم إيقافك بشكل دائم", d.message); throw new Error("suspended"); }
        return d;
      }, function () { S.online = false; renderNet(); throw new Error("net"); });
  }
  var api = function (a, d) { return post(a, d, true); };

  /* ---------- طابور الكتابة: التعديل بيظهر فورًا والسيرفر بيتحدّث في الخلفية ---------- */
  function enqueue(action, data, failMsg) {
    S.wseq++; S.queue.push({ action: action, data: data, failMsg: failMsg }); renderNet(); pump();
  }
  function pump() {
    if (S.flushing || !S.queue.length) return;
    S.flushing = true; var op = S.queue[0];
    api(op.action, op.data).then(function (d) {
      S.queue.shift(); S.flushing = false; S.failN = 0;
      if (!d || d.status !== "success") toast((d && d.message) || op.failMsg || "تعذر حفظ التعديل", "err");
      renderNet(); if (S.queue.length) pump(); else drained();
    }, function (e) {
      S.flushing = false;
      if (e.message === "net") { S.failN++; renderNet(); setTimeout(pump, Math.min(3000 * S.failN, 30000)); }
      else { S.queue = []; renderNet(); }
    });
  }
  function drained() { S.sig = {}; refresh(true); }      // بعد ما كل التعديلات توصل: نسحب الحالة الحقيقية من السيرفر ونتأكد إنها مطابقة
  self.addEventListener("online", function () { S.online = true; renderNet(); if (S.queue.length) pump(); else refresh(true); });
  self.addEventListener("offline", function () { S.online = false; renderNet(); });
  setInterval(renderNet, 5000);
  setInterval(function () { if (S.queue.length && !S.flushing) pump(); }, 8000);

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
    closeDrawer(); S.page = p; S.selected = null; S.viewPilot = null; S.open = null;
    document.querySelectorAll(".drawer-item").forEach(function (el) { el.classList.toggle("on", el.dataset.page === p); });
    renderPage(); window.scrollTo(0, 0);
  }
  function renderPage() {
    var sub = $("subNav"), main = $("mainContent");
    sub.style.display = "none"; main.className = "main"; S.subKind = "";
    ({ profile: renderProfile, about: renderAbout, management: renderManagement, trackPilots: renderTrackPilots, monitorStaff: renderMonitorStaff, trackContractors: renderContractors })[S.page]();
  }
  function soon(title, icon, text) {
    return '<div class="tab-pane on">' + (title ? '<div class="tab-head"><h2><i class="fa-solid ' + icon + '" style="margin-left:6px;color:var(--accent);"></i>' + title + "</h2></div>" : "") +
      '<div class="placeholder-soon"><i class="fa-solid fa-hourglass-half"></i><h2>قريبًا</h2><p>' + text + "</p></div></div>";
  }
  // الشريط العلوي: بيتبني مرة واحدة لكل صفحة، وبعد كده بنبدّل الاختيار بس (من غير ما يرجع لأوله ولا يعمل "ريفريش")
  function setChipOn(act, v) { document.querySelectorAll('#subNav .sub-chip[data-act="' + act + '"]').forEach(function (c) { c.classList.toggle("on", c.dataset.v === v); }); var on = document.querySelector("#subNav .sub-chip.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  function ensureSubNav(kind, items, act, cur) {
    var sub = $("subNav"); sub.style.display = "flex"; $("mainContent").className = "main with-sub";
    if (S.subKind !== kind) { sub.innerHTML = chips(items, cur, act); S.subKind = kind; sub.scrollLeft = 0; } else setChipOn(act, cur);
  }
  function setSubBtn(act, v) { document.querySelectorAll('.msub .act-btn[data-act="' + act + '"]').forEach(function (b) { var on = b.dataset.v === v; b.classList.toggle("pri", on); b.classList.toggle("sec", !on); }); }
  function chips(items, current, act) {
    return items.map(function (t) {
      return t === "|" ? '<span class="sub-sep"></span>' : '<div class="sub-chip' + (current === t[0] ? " on" : "") + '" data-act="' + act + '" data-v="' + t[0] + '">' + t[1] + "</div>";
    }).join("");
  }
  var loader = '<div class="loader"><div class="spinner"></div></div>';

  /* ---------- بيانات الطيارين: قوايم مشتقة من قايمة واحدة ---------- */
  var isPerm = function (p) { return /نهائي|دائم/.test(p.personStatus || ""); };
  var isBike = function (p) { return /عجل/.test(p.vehicle || ""); };
  var onShift = function (p) { return isAcc(p.requestStatus) && p.personStatus === "يعمل" && p.shift === "يعمل الان"; };
  var PL = {
    pending: function (p) { return p.requestStatus === "منتظر"; },
    accepted: function (p) { return isAcc(p.requestStatus) && !isPerm(p); },
    rejected: function (p) { return p.requestStatus === "مرفوض"; },
    blocked: function (p) { return isAcc(p.requestStatus) && isPerm(p); },
    working: onShift,
    off: function (p) { return isAcc(p.requestStatus) && p.personStatus === "يعمل" && p.shift !== "يعمل الان"; }
  };
  function pilotsOf(k) { var r = (S.pilots || []).filter(PL[k]); if (k === "pending") r = r.slice().reverse(); return r; }
  function pilotBy(ph) { var f = null; (S.pilots || []).forEach(function (p) { if (String(p.phone) === String(ph)) f = p; }); return f; }
  function loadOf(ph) {
    var acc = 0, prep = 0, del = 0;
    (S.orders || []).forEach(function (o) { if (o.pilotPhone === ph) { if (o.stage === "accepted") acc++; else if (o.stage === "preparing") prep++; else if (o.stage === "delivering") del++; } });
    return { acc: acc, prep: prep, del: del, work: prep + del };
  }
  // متاح = مفيش معاه حاجة | شبه متاح = معاه مقبولة بس | مشغول = معاه تجهيز أو توصيل
  function availOf(ph) { var l = loadOf(ph); return l.work ? "busy" : (l.acc ? "semi" : "free"); }
  var AV_TXT = { free: "متاح", semi: "شبه متاح", busy: "مشغول" };
  var avBadge = function (k) { return '<span class="avb ' + k + '">' + AV_TXT[k] + "</span>"; };

  /* ---------- الإدارة والتعيين ---------- */
  var MGMT_TABS = [["pilots", "الطيارين"], ["staff", "الموظفين"], ["customers", "العملاء"], ["stores", "المحلات المتعاقدة"]];
  var PIL_SUBS = [["pending", "طلبات التعيين"], "|", ["accepted", "المعينين"], ["rejected", "المرفوضين"], "|", ["blocked", "موقوف نهائي"]];
  var CUST_SUBS = [["ok", "مقبول"], ["bad", "محظور"]];
  function subBtns(items, cur, act) {
    return '<div class="msub">' + items.map(function (t) {
      return t === "|" ? '<span class="vsep"></span>' : '<button class="act-btn ' + (cur === t[0] ? "pri" : "sec") + '" data-act="' + act + '" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }
  function renderManagement() {
    var main = $("mainContent"); ensureSubNav("mgmt", MGMT_TABS, "mgmtTab", S.mgmtTab);
    if (S.selected) { renderMgmtDetail(); return; }
    if (S.mgmtTab === "stores") { main.innerHTML = soon("", "", "هيتم تفعيل المحلات المتعاقدة هنا لاحقًا."); return; }
    if (S.mgmtTab === "staff") { main.innerHTML = soon("", "", "هيتم تفعيل تعيين الموظفين هنا لاحقًا."); return; }
    if (S.mgmtTab === "customers") { renderCustomersPage(); return; }
    main.innerHTML = '<div class="tab-pane on"><div class="tab-head"><h2><i class="fa-solid fa-motorcycle" style="margin-left:6px;color:var(--accent);"></i>الطيارين</h2></div>' + subBtns(PIL_SUBS, S.mgmtSub, "mgmtSub") +
      '<div class="search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" class="search-input" id="mgmtSearch" placeholder="ابحث بالاسم أو رقم الهاتف..." value="' + esc(S.search) + '"></div><div id="mgmtListSlot">' + loader + "</div></div>";
    renderMgmtList(); if (!S.pilots) fetchPilots();
  }
  function renderMgmtList() {
    var slot = $("mgmtListSlot"); if (!slot) return;
    if (!S.pilots) { slot.innerHTML = loader; return; }
    var q = (S.search || "").trim().toLowerCase(), data = pilotsOf(S.mgmtSub);
    if (q) data = data.filter(function (p) { return (p.name || "").toLowerCase().indexOf(q) !== -1 || String(p.phone || "").indexOf(q) !== -1; });
    if (!data.length) { slot.innerHTML = '<div class="empty"><i class="fa-solid ' + (q ? "fa-magnifying-glass" : "fa-inbox") + '"></i><h3>' + (q ? "لا يوجد نتائج مطابقة للبحث" : "لا يوجد بيانات هنا") + "</h3></div>"; return; }
    var h = '<div class="dp-card">';
    data.forEach(function (p) {
      var cls, txt;
      if (S.mgmtSub === "accepted" || S.mgmtSub === "blocked") {
        txt = p.personStatus || "—"; cls = txt === "يعمل" ? "accepted" : (/مؤقت/.test(txt) ? "pending" : "rejected");
      } else { txt = p.requestStatus; cls = txt === "منتظر" ? "pending" : (txt === "مرفوض" ? "rejected" : "accepted"); }
      h += '<div class="dp-row" data-act="openPilot" data-id="' + esc(p.phone) + '"><i class="fa-solid fa-user ic"></i><div class="txt"><h4>' + esc(p.name) + "</h4><p>" + esc(p.phone) + '</p></div><span class="status-badge ' + cls + '">' + esc(txt) + '</span><i class="fa-solid fa-chevron-left" style="color:var(--dim);font-size:12px;margin-right:4px;"></i></div>';
    });
    slot.innerHTML = h + "</div>";
  }
  function openPilot(phone) {
    var f = pilotBy(phone); if (!f) return;
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
  function infoRow(icon, label, val, extra) { return '<div class="dp-row edit-row"><i class="fa-solid ' + icon + ' ic"></i><div class="txt"><h4>' + label + "</h4><p>" + esc(val || "—") + "</p></div>" + (extra || "") + "</div>"; }
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
  // حفظ لحظي: الشاشة بتتحدّث فورًا والسيرفر في الخلفية
  function saveInfo() {
    var p = S.selected; if (!p) return;
    var orig = p.phone, fields = JSON.parse(JSON.stringify(S.drafts));
    for (var k in fields) p[k] = fields[k];
    S.orig = JSON.parse(JSON.stringify(S.drafts)); S.editing = {};
    toast("تم حفظ التعديلات", "ok"); renderPage();
    enqueue("updatePersonInfo", { type: "pilots", originalPhone: orig, fields: fields }, "تعذر حفظ بيانات الطيار");
  }
  function saveStatus() {
    var p = S.selected; if (!p) return;
    p.requestStatus = S.draftReq; p.personStatus = S.draftPerson;
    if (isAcc(p.requestStatus) && !p.assignDate) p.assignDate = nowStr();
    enqueue("updatePersonStatus", { type: "pilots", phone: p.phone, requestStatus: S.draftReq, personStatus: S.draftPerson }, "تعذر تحديث حالة الطيار");
    toast("تم تحديث الحالة", "ok"); closeDetail();
  }

  /* ---------- العملاء ---------- */
  function custBad(c) { return /موقوف|محظور|حظر/.test(c.status || "") || /حذف/.test(c.prog || ""); }
  function renderCustomersPage() {
    $("mainContent").innerHTML = '<div class="tab-pane on"><div class="tab-head"><h2><i class="fa-solid fa-users" style="margin-left:6px;color:var(--accent);"></i>العملاء</h2><div class="tab-badge" id="custBadge">0</div></div>' + subBtns(CUST_SUBS, S.custSub, "custSub") +
      '<div class="search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" class="search-input" id="custSearch" placeholder="ابحث بالاسم أو رقم الهاتف..." value="' + esc(S.custSearch) + '"></div><div id="custListSlot">' + loader + "</div></div>";
    renderCustList(); if (!S.custs) fetchCustomers();
  }
  function renderCustList() {
    var slot = $("custListSlot"); if (!slot) return;
    if (!S.custs) { slot.innerHTML = loader; return; }
    var want = S.custSub === "bad", data = S.custs.filter(function (c) { return custBad(c) === want; }), b = $("custBadge"); if (b) b.textContent = data.length;
    var q = (S.custSearch || "").trim().toLowerCase();
    if (q) data = data.filter(function (c) { return (c.name || "").toLowerCase().indexOf(q) !== -1 || String(c.phone || "").indexOf(q) !== -1; });
    if (!data.length) { slot.innerHTML = '<div class="empty"><i class="fa-solid ' + (q ? "fa-magnifying-glass" : "fa-user-slash") + '"></i><h3>' + (q ? "لا يوجد نتائج مطابقة للبحث" : (want ? "لا يوجد عملاء محظورين" : "لا يوجد عملاء مسجلين بعد")) + "</h3></div>"; return; }
    var h = '<div class="dp-card">';
    data.forEach(function (c) {
      var bad = custBad(c), label = /حذف/.test(c.prog || "") ? "حذف" : (c.status || "جيد");
      h += '<div class="dp-row" data-act="openCust" data-id="' + esc(c.phone) + '"><i class="fa-solid fa-user ic"></i><div class="txt"><h4>' + esc(c.name) + "</h4><p>" + esc(c.phone) + '</p></div><span class="status-badge ' + (bad ? "rejected" : "accepted") + '">' + esc(label) + '</span><i class="fa-solid fa-chevron-left" style="color:var(--dim);font-size:12px;margin-right:4px;"></i></div>';
    });
    slot.innerHTML = h + "</div>";
  }
  function openCust(phone) {
    var c = null; (S.custs || []).forEach(function (x) { if (String(x.phone) === String(phone)) c = x; });
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
      var c = null; (S.custs || []).forEach(function (x) { if (String(x.phone) === String(phone)) c = x; }); if (!c) return;
      c[kind] = v; var data = { phone: phone }; data[kind] = v;
      closeModal(); toast("تم تحديث حالة العميل", "ok"); rerender();
      enqueue("updateCustomerStatus", data, "تعذر حفظ حالة العميل");
    };
    if (v === "موقوف" || v === "حذف") confirmBox(v === "حذف" ? "سيتم إلغاء تثبيت التطبيق من جهاز العميل وقفله. متأكد؟" : "سيتم حظر العميل من استخدام التطبيق. متأكد؟", run);
    else run();
  }
  function confirmBox(text, onYes, onNo) {
    S.cfmYes = onYes; S.cfmNo = onNo || null;
    $("modalBox").classList.remove("tall");
    $("modalBox").innerHTML = '<div class="modal-bar"></div><div class="cfm-icon dan"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="cfm-txt">' + esc(text) + '</div><div class="modal-btns"><button class="act-btn dan" style="flex:1;" data-act="confirmYes">تأكيد</button><button class="act-btn sec" style="flex:1;" data-act="confirmNo">إلغاء</button></div>';
    $("modalBg").classList.add("show");
  }
  function closeModal() { $("modalBox").classList.remove("tall"); $("modalBg").classList.remove("show"); S.pickBon = null; S.pickSel = null; if (S.lc) { clearTimeout(S.lc.timer); S.lc = null; } }

  /* ---------- الفاتورة ---------- */
  function parseLines(txt) {
    return String(txt || "").split("\n").filter(Boolean).map(function (x) {
      var m = String(x).match(/^(.*?)\s×\s(\d+)(?:\s\(\+(\d+)\s([^)]*)\))?\s=\s([\d.,]+)/);
      if (!m) return { n: String(x), q: 0, t: 0, p: 0, raw: true };
      var q = +m[2], t = parseFloat(m[5].replace(/,/g, "")) || 0, ex = +m[3] || 0, w = m[4] || "", f = 0;
      if (ex) { var pc = w.match(/خصم\s*(\d+(?:\.\d+)?)\s*%/); f = /هدي/.test(w) ? 0 : /نص/.test(w) ? 0.5 : pc ? 1 - parseFloat(pc[1]) / 100 : 0; }
      return { n: m[1].trim(), q: q, t: t, p: q ? t / (q + ex * f) : 0, ex: ex, w: w };
    });
  }
  var num = function (n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }); };
  function invTotal(o) { var sum = parseLines(o.items).reduce(function (a, l) { return a + l.t; }, 0); return (sum > 0 ? sum : Number(o.goods) || 0) + (Number(o.fee) || 0); }
  function invoiceTable(o) {
    var rows = parseLines(o.items).map(function (l) {
      return '<tr><td class="inv-n">' + esc(l.n) + (l.ex ? '<span class="inv-bx">+' + l.ex + " " + esc(l.w) + "</span>" : "") + "</td><td>" + (l.raw ? "-" : num(l.p)) + "</td><td>" + (l.raw ? "-" : l.q) + "</td><td><b>" + (l.raw ? "-" : num(l.t)) + "</b></td></tr>";
    }).join("");
    rows += '<tr class="ship"><td class="inv-n">التوصيل</td><td>—</td><td>—</td><td><b>' + num(o.fee) + "</b></td></tr>";
    return '<div class="inv-sub"><span>فاتورة الطلب رقم ' + o.bon + "</span>" + (o.dateTxt ? "<span>" + esc((o.day ? o.day + " " : "") + o.dateTxt) + "</span>" : "") + (o.timeTxt ? "<span>" + esc(o.timeTxt) + "</span>" : "") + "</div>" +
      '<table class="inv-t"><thead><tr><th class="inv-n">اسم الصنف</th><th>سعر القطعة</th><th>العدد</th><th>الإجمالي</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="4"><div class="inv-f"><span>الإجمالي النهائي</span><b>' + num(invTotal(o)) + " ج.م</b></div></td></tr>" +
      (o.note ? '<tr><td colspan="4"><div class="inv-note"><span>ملحوظة العميل :</span><p>' + esc(o.note) + "</p></div></td></tr>" : "") + "</tfoot></table>";
  }
  function invBlock(o) {
    var on = !!S.inv[o.bon];
    return '<div class="inv' + (on ? " open" : "") + '"><button type="button" class="inv-h" data-act="invToggle" data-bon="' + o.bon + '"><b class="inv-title">' + (on ? "صيدلية عوف" : "افتح الفاتورة") + '</b><span class="inv-arw"><i class="fa-solid fa-chevron-down"></i></span><img src="assets/logo.png" alt=""></button><div class="inv-body">' + invoiceTable(o) + "</div></div>";
  }

  /* ---------- كروت الطلبات ---------- */
  function ageNow(o) { return o.ageMin >= 0 ? o.ageMin + Math.floor((Date.now() - S.lastSync) / 60000) : -1; }
  var ageCls = function (m) { return m < 0 ? "" : m < 10 ? "g" : m < 20 ? "y" : "r"; };
  function clockParts(m) { return m < 0 ? ["--", "--", "--"] : [p2(Math.floor(m / 1440)), p2(Math.floor((m % 1440) / 60)), p2(m % 60)]; }
  function miniClock(o) {
    var m = ageNow(o), c = clockParts(m);
    return '<span class="mclk ' + ageCls(m) + '" data-a="' + o.ageMin + '" dir="ltr"><span class="g"><small>ي</small><b>' + c[0] + '</b></span><i>:</i><span class="g"><small>س</small><b>' + c[1] + '</b></span><i>:</i><span class="g"><small>د</small><b>' + c[2] + "</b></span></span>";
  }
  function tickClocks() {
    document.querySelectorAll(".mclk[data-a]").forEach(function (el) {
      var a = +el.dataset.a; if (a < 0) return; var m = a + Math.floor((Date.now() - S.lastSync) / 60000), c = clockParts(m), b = el.querySelectorAll("b");
      b[0].textContent = c[0]; b[1].textContent = c[1]; b[2].textContent = c[2]; el.className = "mclk " + ageCls(m);
    });
  }
  setInterval(tickClocks, 15000);
  function etaInfo(o) {
    if (o.stage === "delivering") {
      if (o.arrived || /وصل/.test(o.custEta)) return { ok: true, icon: "fa-location-dot", text: "المندوب وصل لموقع العميل ✅" };
      return { ok: false, icon: "fa-clock", text: "فاضل على وصول المندوب للعميل: " + (o.custEta ? o.custEta : "جاري الحساب…") };
    }
    if (o.stage === "accepted" && o.shopEta) return /وصل/.test(o.shopEta) ? { ok: true, icon: "fa-store", text: "المندوب وصل الصيدلية ✅" } : { ok: false, icon: "fa-store", text: "وصول المندوب للصيدلية خلال: " + o.shopEta };
    return null;
  }
  function etaStrip(o) { var e = etaInfo(o); return e ? '<div class="etab' + (e.ok ? " ok" : "") + '"><i class="fa-solid ' + e.icon + '"></i> ' + esc(e.text) + "</div>" : ""; }
  // العنوان: السطر الأول لحد أول "علامة بداية جديدة" (عزبة/شارع/عمارة/فاصلة...) والباقي في السطر اللي تحته
  var ADDR_BRK = /\s*[-–—،,\/]\s+|\s(?=(?:عزبة|قرية|كفر|نجع|شارع|ش\d|ش\s|عمارة|برج|حارة|دور|الدور|شقة|منزل|بيت)(?:\s|\d|$))/g;
  function addrLines(o) {
    var street = String(o.street || "").replace(/\s+/g, " ").trim(), first = street, rest = "", m;
    ADDR_BRK.lastIndex = 0;
    while ((m = ADDR_BRK.exec(street))) {
      if (m.index >= 4 && m.index < street.length - 2) { first = street.slice(0, m.index).trim(); rest = street.slice(m.index + m[0].length).trim(); break; }
      if (m[0].length === 0) ADDR_BRK.lastIndex++;
    }
    var l1 = [o.area, first].filter(Boolean).join(" — ");
    return [l1, rest].filter(Boolean);
  }
  function custBlock(o) {
    var url = mapsUrl(o.cloc), lines = addrLines(o);
    var btns = o.phone ? '<div class="cbtns"><a class="ib call" href="tel:' + esc(o.phone) + '" aria-label="اتصال"><i class="fa-solid fa-phone"></i></a><a class="ib wa" href="' + esc(waUrl(o.phone)) + '" target="_blank" rel="noopener" aria-label="واتساب"><i class="fa-brands fa-whatsapp"></i></a></div>' : "";
    var map = url ? '<div class="mapcol"><a class="ib map" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="الموقع على الخريطة"><i class="fa-solid fa-location-dot"></i></a>' + (o.km > 0 ? '<span class="kmtag">' + o.km.toFixed(3) + " كم</span>" : "") + "</div>" : "";
    return '<div class="ic-sec"><div class="ic-row"><div class="ic-txt"><div class="ic-lbl">اسم العميل :</div><div class="ic-name">' + esc(o.name || "—") + "</div></div>" + btns + "</div>" +
      '<div class="ic-row ic-adr"><div class="ic-txt"><div class="ic-lbl">العنوان :</div><div class="ic-addr">' + (lines.length ? lines.map(esc).join("<br>") : "—") + "</div>" + (o.landmark ? "<small>علامة مميزة : " + esc(o.landmark) + "</small>" : "") + "</div>" + map + "</div></div>";
  }
  function pilotBox(o, label) {
    var L = splitLabel(o.pilotName), p = pilotBy(o.pilotPhone), veh = L.veh || (p && p.vehicle) || "—";
    return '<div class="pbox"><div class="ptxt"><div><span class="pl">' + (label || "الطيار الحالي :") + '</span><b>' + esc(L.name || "—") + '</b></div><div><span class="pl">المركبة :</span><b>' + esc(veh) + "</b></div></div>" +
      (o.pilotPhone ? '<a class="ib call" href="tel:' + esc(o.pilotPhone) + '" aria-label="اتصال بالطيار"><i class="fa-solid fa-phone"></i></a>' : "") + "</div>";
  }
  function prevRows(o) {
    var r = "";
    [[o.prev1, o.prev1Phone, "الطيار السابق 1 :"], [o.prev2, o.prev2Phone, "الطيار السابق 2 :"]].forEach(function (x) {
      if (!x[0]) return; var L = splitLabel(x[0]), p = pilotBy(x[1]), veh = L.veh || (p && p.vehicle) || "—";
      r += '<div class="pbox prev"><div class="ptxt"><div class="ptitle">' + x[2] + '</div><div><span class="pl">الطيار :</span><b>' + esc(L.name || "—") + '</b></div><div><span class="pl">المركبة :</span><b>' + esc(veh) + "</b></div></div>" +
        (x[1] ? '<a class="ib call" href="tel:' + esc(x[1]) + '" aria-label="اتصال"><i class="fa-solid fa-phone"></i></a>' : "") + "</div>";
    });
    return r;
  }
  function pilotsSection(o, label) { return '<div class="sec-ttl">الطيارين المستلمين :</div>' + (o.pilotName ? pilotBox(o, label) : "") + prevRows(o); }
  function tcardHTML(o) {
    var e = etaInfo(o);
    return '<div class="tcard"><div><small>اليوم</small><b>' + esc(o.day || "—") + (o.dateTxt ? " <span>(" + esc(o.dateTxt) + ")</span>" : "") + '</b></div><div><small>الساعة</small><b>' + esc(o.timeTxt || "—") + "</b></div><div><small>التأخير</small>" + miniClock(o) + "</div>" +
      (e ? '<div class="tc-eta' + (e.ok ? " ok" : "") + '"><i class="fa-solid ' + e.icon + '"></i><span>' + esc(e.text) + "</span></div>" : "") + "</div>";
  }
  function ordCard(o) {
    var open = S.open === o.bon, tag = '<span class="mtag ' + o.stage + '">' + STAGE_TAG[o.stage] + "</span>";
    var arw = open ? '<button class="arw" data-act="ocClose" aria-label="قفل"><i class="fa-solid fa-chevron-down"></i></button>' : '<span class="arw"><i class="fa-solid fa-chevron-down"></i></span>';
    var area = '<span class="amid"><span class="tag ap"><i class="fa-solid fa-location-dot"></i>' + esc(o.area || "—") + "</span></span>";
    var head = open ? '<div class="ahead"><span class="bon">#' + o.bon + "</span>" + '<span class="amid">' + miniClock(o) + '</span><span class="aside">' + tag + arw + "</span></div>"
      : '<button class="ahead" data-act="ocOpen" data-bon="' + o.bon + '"><span class="bon">#' + o.bon + "</span>" + area + '<span class="aside">' + tag + arw + "</span></button>";
    var h = '<div class="ac' + (open ? " open" : "") + '" id="o' + o.bon + '">' + head + '<div class="glowln"></div>';
    if (!open) return h + tcardHTML(o) + "</div>";
    h += '<div class="abody">' + custBlock(o) + etaStrip(o) + invBlock(o);
    if (o.stage === "new") h += '<div class="arow"><button class="act-btn dan" data-act="cancelOrder" data-bon="' + o.bon + '"><i class="fa-solid fa-ban"></i> إلغاء الطلب</button></div>';
    else h += pilotsSection(o) + '<div class="arow three"><button class="act-btn sec" data-act="pickOpen" data-bon="' + o.bon + '"><i class="fa-solid fa-right-left"></i><span>تحويل لطيار آخر</span></button><button class="act-btn sec loc" data-act="lcOpen" data-bon="' + o.bon + '"><i class="fa-solid fa-location-crosshairs"></i><span>تعديل اللوكيشن</span></button><button class="act-btn dan" data-act="cancelOrder" data-bon="' + o.bon + '"><i class="fa-solid fa-ban"></i><span>إلغاء الطلب</span></button></div>';
    return h + "</div></div>";
  }
  function delCard(o) {
    var open = S.open === o.bon, tag = '<span class="mtag delivered">' + STAGE_TAG.delivered + "</span>";
    var arw = open ? '<button class="arw" data-act="ocClose"><i class="fa-solid fa-chevron-down"></i></button>' : '<span class="arw"><i class="fa-solid fa-chevron-down"></i></span>';
    var inner = '<span class="bon">#' + o.bon + '</span><span class="amid"><span class="tag ap"><i class="fa-solid fa-location-dot"></i>' + esc(o.area || "—") + '</span></span><span class="aside">' + tag + arw + "</span>";
    var h = '<div class="ac' + (open ? " open" : "") + '" id="o' + o.bon + '">' + (open ? '<div class="ahead">' + inner + "</div>" : '<button class="ahead" data-act="ocOpen" data-bon="' + o.bon + '">' + inner + "</button>") + '<div class="glowln"></div>';
    if (!open) return h + '<div class="tcard"><div><small>يوم التسليم</small><b>' + esc(o.doneDay || "—") + (o.doneDateTxt ? " <span>(" + esc(o.doneDateTxt) + ")</span>" : "") + '</b></div><div><small>الساعة</small><b>' + esc(o.doneTimeTxt || "—") + '</b></div><div><small>الإجمالي</small><b dir="ltr">' + num(invTotal(o)) + " ج.م</b></div></div></div>";
    var cell = function (cls, l, v) { return '<div class="dc ' + cls + '"><small>' + l + "</small><b>" + v + "</b></div>"; };
    var dm = function (m) { return m >= 0 ? esc(fmtDur(m)) : "—"; };
    var goods = Math.max(0, invTotal(o) - (Number(o.fee) || 0));
    h += '<div class="abody"><div class="dgrid">' +
      cell("blue s6", "تاريخ الطلب", esc(o.dateTxt || "—")) + cell("blue s6", "وقت الطلب", esc(o.timeTxt || "—")) +
      cell("gold s3", "وقت القبول", esc(o.accTxt || "—")) + cell("gold s3", "وقت الوصول للصيدلية", esc(o.pharmTxt || "—")) + cell("gold s3", "انتهاء التجهيز", esc(o.prepEndTxt || "—")) + cell("gold s3", "مدة التجهيز", dm(o.prepDurMin)) +
      cell("orng s4", "بدء التوصيل", esc(o.delivTxt || "—")) + cell("orng s4", "وقت التسليم", esc(o.doneTimeTxt || "—")) + cell("orng s4", "مدة التوصيل", dm(o.delivDurMin)) +
      cell("grn s12", "إجمالي مدة إنهاء الطلب", dm(o.totMin)) +
      cell("red s6", "سعر الطلب", num(goods) + " ج") + cell("grn s6", "خدمة التوصيل", num(o.fee) + " ج") + "</div>" +
      custBlock(o) + invBlock(o) + pilotsSection(o, "الطيار المسلّم :") + "</div></div>";
    return h;
  }

  /* ---------- متابعة الطيارين ---------- */
  var TP_TABS = [["working", "يعمل الان"], ["off", "لا يعمل"], "|", ["new", "الطلبات الجديدة"], ["accepted", "الطلبات المقبولة"], ["preparing", "جاري التحضير"], ["delivering", "جاري التوصيل"], "|", ["delivered", "طلبات تم توصيلها"]];
  var TP_TITLES = { working: "الطيارين - يعمل الان", off: "الطيارين - لا يعمل", "new": "الطلبات الجديدة", accepted: "الطلبات المقبولة", preparing: "جاري التحضير", delivering: "جاري التوصيل", delivered: "طلبات تم توصيلها" };
  function renderTrackPilots() {
    ensureSubNav("tp", TP_TABS, "tpTab", S.tpTab);
    $("mainContent").innerHTML = '<div class="tab-pane on"><div id="tpBody">' + loader + "</div></div>";
    renderTpBody(); fetchPilots(); fetchActive(); if (S.tpTab === "delivered") fetchDelivered();
  }
  function renderTpBody() {
    var el = $("tpBody"); if (!el) return;
    var y = window.scrollY, t = S.tpTab, h = "";
    if (S.viewPilot) { el.innerHTML = pilotView(); window.scrollTo(0, y); return; }
    var head = function (n) { return '<div class="tab-head"><h2>' + TP_TITLES[t] + '</h2><div class="tab-badge">' + n + "</div></div>"; };
    if (t === "working" || t === "off") {
      if (!S.pilots) { el.innerHTML = loader; return; }
      var list = pilotsOf(t); h = head(list.length);
      if (!list.length) h += '<div class="empty"><i class="fa-solid fa-user-clock"></i><h3>' + (t === "working" ? "لا يوجد طيارين يعملون الآن" : "لا يوجد طيارين متوقفين") + "</h3></div>";
      else {
        h += '<div class="dp-card">'; list.forEach(function (p) {
          var badge = t === "working" ? (S.orders ? avBadge(availOf(p.phone)) : "") : '<span class="avb off">لا يعمل</span>';
          h += '<div class="dp-row" data-act="viewPilot" data-id="' + esc(p.phone) + '"><i class="fa-solid ' + (isBike(p) ? "fa-bicycle" : "fa-motorcycle") + ' ic"></i><div class="txt"><h4>' + esc(p.name) + "</h4><p>" + esc(p.vehicle || "—") + " · " + esc(p.phone) + "</p></div>" + badge + '<i class="fa-solid fa-chevron-left" style="color:var(--dim);font-size:12px;margin-right:4px;"></i></div>';
        }); h += "</div>";
      }
    } else if (t === "delivered") {
      if (!S.delivered) { el.innerHTML = loader; return; }
      h = head(S.delivered.length); if (!S.delivered.length) h += '<div class="empty"><i class="fa-solid fa-inbox"></i><h3>لا توجد طلبات هنا</h3></div>';
      if (S.open !== null && !S.delivered.some(function (o) { return o.bon === S.open; })) S.open = null;
      S.delivered.forEach(function (o) { if (S.open === null || S.open === o.bon) h += delCard(o); });
    } else {
      if (!S.orders) { el.innerHTML = loader; return; }
      var ol = S.orders.filter(function (o) { return o.stage === t; }); h = head(ol.length);
      if (!ol.length) h += '<div class="empty"><i class="fa-solid fa-inbox"></i><h3>لا توجد طلبات هنا</h3></div>';
      if (S.open !== null && !ol.some(function (o) { return o.bon === S.open; })) S.open = null;
      ol.forEach(function (o) { if (S.open === null || S.open === o.bon) h += ordCard(o); });
    }
    el.innerHTML = h; window.scrollTo(0, y);
  }
  // ملف الطيار (عرض فقط - أي تعديل من الإدارة والتعيين)
  function pilotView() {
    var p = pilotBy(S.viewPilot); if (!p) { S.viewPilot = null; return ""; }
    var L = loadOf(p.phone), on = onShift(p), mine = (S.orders || []).filter(function (o) { return o.pilotPhone === p.phone; });
    var badges = '<span class="avb ' + (on ? "free" : "off") + '">' + (on ? "يعمل الان" : "لا يعمل") + "</span>" + (on && S.orders ? avBadge(availOf(p.phone)) : "") + (p.personStatus !== "يعمل" ? '<span class="avb busy">' + esc(p.personStatus) + "</span>" : "");
    var pw = S.pwShown ? esc(p.password || "—") : "••••••";
    return '<div class="tab-head"><div style="display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-arrow-right" style="cursor:pointer;color:var(--accent);padding:6px;" data-act="pvBack"></i><h2 style="font-size:15px;">ملف الطيار</h2></div></div>' +
      '<div class="dp-card"><div class="dp-top"><div class="dp-avatar"></div><div class="dp-name">' + esc(p.name) + '</div><div class="dp-role">طيار - ' + esc(p.vehicle || "—") + '</div><div class="pv-badges">' + badges + '</div><div class="pv-acts"><a class="ib call" href="tel:' + esc(p.phone) + '"><i class="fa-solid fa-phone"></i></a><a class="ib wa" href="' + esc(waUrl(p.phone)) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i></a></div></div>' +
      '<div class="pv-stats"><div><small>مقبولة</small><b>' + L.acc + "</b></div><div><small>تجهيز</small><b>" + L.prep + "</b></div><div><small>توصيل</small><b>" + L.del + "</b></div><div><small>المحفظة</small><b>" + num(p.wallet) + "</b></div></div>" +
      (mine.length ? '<div style="padding:0 12px 12px;text-align:center;">' + mine.map(function (o) { return '<span class="chip-o">#' + o.bon + " · " + STAGE_TAG[o.stage] + "</span>"; }).join("") + "</div>" : "") + "</div>" +
      '<div class="dp-card">' + infoRow("fa-phone", "رقم الهاتف", p.phone) + infoRow("fa-lock", "كلمة المرور", pw, '<i class="fa-solid ' + (S.pwShown ? "fa-eye-slash" : "fa-eye") + ' pw-eye" data-act="pvPw"></i>') + infoRow("fa-map-location-dot", "العنوان", p.address) + infoRow("fa-id-card", "الرقم القومي", p.idCard) +
      infoRow("fa-calendar-days", "تاريخ الميلاد", p.birthDate) + infoRow("fa-cake-candles", "السن", p.age ? p.age + " سنة" : "") + infoRow("fa-motorcycle", "المركبة", p.vehicle) + infoRow("fa-clock", "تاريخ التعيين", p.assignDate) + infoRow("fa-user-clock", "الشيفت الحالي", p.shift) + "</div>" +
      '<div class="pv-hint">للعرض فقط — للتعديل افتح «الإدارة والتعيين ← الطيارين».</div>';
  }

  /* ---------- شاشة تحويل الطلب لطيار آخر ---------- */
  var rank = { free: 0, semi: 1, busy: 2 };
  function pickCands(o) {
    return (S.pilots || []).filter(function (p) { return onShift(p) && p.phone !== o.pilotPhone; }).map(function (p) { return { p: p, av: availOf(p.phone) }; });
  }
  function pickOpen(bon) {
    var o = orderBy(bon); if (!o) return;
    var c = pickCands(o), ok = function (b) { return c.filter(function (x) { return isBike(x.p) === b && x.av !== "busy"; }).length; };
    S.pickBon = bon; S.pickSel = null; S.pickType = ok(false) >= ok(true) ? "fuel" : "bike";
    renderPicker(); $("modalBg").classList.add("show");
  }
  function renderPicker() {
    var o = orderBy(S.pickBon); if (!o) { closeModal(); return; }
    var box = $("modalBox"), old = box.querySelector(".pk-list"), st = old ? old.scrollTop : 0;
    var c = pickCands(o), bike = c.filter(function (x) { return isBike(x.p); }), fuel = c.filter(function (x) { return !isBike(x.p); });
    var list = (S.pickType === "bike" ? bike : fuel).slice().sort(function (a, b) { return rank[a.av] - rank[b.av] || String(a.p.name).localeCompare(String(b.p.name), "ar"); });
    var sel = null; c.forEach(function (x) { if (x.p.phone === S.pickSel && x.av !== "busy") sel = x; }); if (!sel) S.pickSel = null;
    var cur = splitLabel(o.pilotName);
    var rows = list.map(function (x) {
      var dis = x.av === "busy";
      return '<div class="pk-row' + (dis ? " dis" : "") + (sel && sel.p.phone === x.p.phone ? " sel" : "") + '"' + (dis ? "" : ' data-act="pickSel" data-id="' + esc(x.p.phone) + '"') + '><span class="pk-rd"></span><div class="pk-n">' + esc(x.p.name) + "<small>" + esc(x.p.vehicle || "—") + "</small></div>" + avBadge(x.av) + "</div>";
    }).join("") || '<div class="pk-empty">لا يوجد طيارين في هذه القائمة يعملون الآن</div>';
    box.innerHTML = '<div class="modal-bar"></div><div class="modal-ttl">تحويل الطلب #' + o.bon + '</div><div class="pk-sub">الطيار الحالي: ' + esc(cur.name || "—") + (cur.veh ? " - " + esc(cur.veh) : "") + "</div>" +
      '<div class="seg"><button class="seg-btn' + (S.pickType === "bike" ? " on" : "") + '" data-act="pickType" data-v="bike"><i class="fa-solid fa-bicycle"></i> عجلة <em>' + bike.length + '</em></button><button class="seg-btn' + (S.pickType === "fuel" ? " on" : "") + '" data-act="pickType" data-v="fuel"><i class="fa-solid fa-gas-pump"></i> بنزين <em>' + fuel.length + "</em></button></div>" +
      '<div class="pk-list">' + rows + "</div>" +
      '<div class="pk-sel">' + (sel ? "الطيار الجديد: <b>" + esc(sel.p.name) + " - " + esc(sel.p.vehicle || "—") + "</b>" : "اختر طيارًا (متاح أو شبه متاح) من القائمة") + "</div>" +
      '<div class="pk-btns"><button class="act-btn pri"' + (sel ? "" : " disabled") + ' data-act="pickConfirm"><i class="fa-solid fa-check"></i> تأكيد التحويل</button><button class="act-btn dan" data-act="pickWithdraw"><i class="fa-solid fa-rotate-left"></i> سحب الطلب</button></div>' +
      '<button class="pk-x" data-act="closeModal" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>';
    var nl = box.querySelector(".pk-list"); if (nl) nl.scrollTop = st; box.classList.add("tall");
  }
  function orderBy(bon) { var f = null; (S.orders || []).forEach(function (o) { if (o.bon === Number(bon)) f = o; }); return f; }
  function pushPrevLocal(o, name, phone) {
    if (!name) return;
    if (!o.prev1) { o.prev1 = name; o.prev1Phone = phone; } else if (!o.prev2) { o.prev2 = name; o.prev2Phone = phone; }
    else { o.prev1 = o.prev2; o.prev1Phone = o.prev2Phone; o.prev2 = name; o.prev2Phone = phone; }
  }
  function pickConfirm() {
    var o = orderBy(S.pickBon), np = pilotBy(S.pickSel); if (!o || !np) return;
    pushPrevLocal(o, o.pilotName, o.pilotPhone);
    o.pilotName = np.name + (np.vehicle ? " - " + np.vehicle : ""); o.pilotPhone = np.phone; o.shopEta = ""; o.custEta = ""; o.arrived = false;
    var bon = o.bon, ph = np.phone; closeModal(); toast("تم تحويل الطلب #" + bon, "ok"); rerender();
    enqueue("reassignPilot", { bon: bon, pilotPhone: ph }, "تعذر تحويل الطلب #" + bon);
  }
  function pickWithdraw() {
    var o = orderBy(S.pickBon); if (!o) return; var bon = o.bon;
    confirmBox("سيتم سحب الطلب #" + bon + " من الطيار وإرجاعه للطلبات الجديدة. متأكد؟", function () {
      var oo = orderBy(bon); if (!oo) return;
      pushPrevLocal(oo, oo.pilotName, oo.pilotPhone); oo.stage = "new"; oo.pilotName = ""; oo.pilotPhone = ""; oo.shopEta = ""; oo.custEta = ""; oo.arrived = false;
      S.open = null; closeModal(); toast("تم سحب الطلب #" + bon, "ok"); rerender();
      enqueue("withdrawOrder", { bon: bon }, "تعذر سحب الطلب #" + bon);
    }, function () { S.pickBon = bon; renderPicker(); });
  }
  function cancelOrder(bon) {
    confirmBox("سيتم إلغاء الطلب #" + bon + " نهائيًا ولا يمكن التراجع. متأكد؟", function () {
      S.orders = (S.orders || []).filter(function (o) { return o.bon !== Number(bon); }); S.open = null;
      closeModal(); toast("تم إلغاء الطلب #" + bon, "ok"); rerender();
      enqueue("cancelOrder", { bon: Number(bon) }, "تعذر إلغاء الطلب #" + bon);
    });
  }

  /* ---------- تعديل اللوكيشن (محل / عميل) ---------- */
  // نفس صيغ اللوكيشن اللي بيفهمها سكربت الطلبات: لينكات جوجل/Apple/Waze، geo:، إحداثيات (عربي/إنجليزي)، درجات-دقايق-ثواني، Plus Code
  var OLC = "23456789CFGHJMPQRVWX", STORE_COORDS = { lat: 30.121208, lng: 31.2491106 };
  var inEgypt = function (la, lo) { return isFinite(la) && isFinite(lo) && la >= 21 && la <= 33 && lo >= 24 && lo <= 37.5; };
  function olcEncode(lat, lng) {
    lat = Math.min(Math.max(lat, -90), 90) + 90; lng = ((lng + 180) % 360 + 360) % 360;
    var res = [20, 1, 0.05, 0.0025, 0.000125], out = "";
    for (var i = 0; i < 5; i++) { var a = Math.floor(lat / res[i]), b = Math.floor(lng / res[i]); lat -= a * res[i]; lng -= b * res[i]; out += OLC.charAt(a) + OLC.charAt(b); }
    return out.slice(0, 8) + "+" + out.slice(8);
  }
  function olcDecode(code, ref) {
    code = String(code).toUpperCase().replace(/\s+/g, ""); var p = code.indexOf("+"); if (p < 0) return null;
    var full = code; if (p < 8) { if (!ref) return null; full = olcEncode(ref.lat, ref.lng).slice(0, 8 - p) + code; }
    var d = full.replace("+", ""), res = [20, 1, 0.05, 0.0025, 0.000125], lat = -90, lng = -180, last = 0;
    for (var i = 0; i < Math.min(d.length, 10) / 2; i++) { var a = OLC.indexOf(d.charAt(2 * i)), b = OLC.indexOf(d.charAt(2 * i + 1)); if (a < 0 || b < 0) return null; lat += a * res[i]; lng += b * res[i]; last = res[i]; }
    return { lat: lat + last / 2, lng: lng + last / 2 };
  }
  function parseCoords(t) {
    t = String(t || "").replace(/[٠-٩]/g, function (x) { return "٠١٢٣٤٥٦٧٨٩".indexOf(x); }).replace(/[۰-۹]/g, function (x) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(x); }).replace(/٫/g, ".").replace(/،/g, ",");
    var vs = [t]; try { var d = decodeURIComponent(t); if (d !== t) vs.push(d); } catch (e) {}
    var ok = function (la, ln) { la = +la; ln = +ln; return inEgypt(la, ln) ? { lat: la, lng: ln } : null; };
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
      if (pc) { var o = olcDecode(pc[1], STORE_COORDS); var r4 = o && ok(o.lat, o.lng); if (r4) return r4; }
    }
    return null;
  }
  var MAPS_URL_RE = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|g\.page|share\.google|google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|waze\.com)/i;
  function locCheck(raw) {
    var s = String(raw || "").trim(); if (!s) return { state: "empty" };
    var u = s.match(/https?:\/\/[^\s]+/i), url = u ? u[0].replace(/[)\].,،;]+$/, "") : "";
    var c = parseCoords(url || s);
    if (c) return { state: "ok", lat: c.lat, lng: c.lng, link: "https://www.google.com/maps?q=" + c.lat + "," + c.lng };
    if (url && MAPS_URL_RE.test(url)) return { state: "resolve", url: url };
    return { state: "bad" };
  }
  function lcOpen(bon) {
    var o = orderBy(bon); if (!o) return;
    S.lc = { bon: bon, which: null, val: "", ok: false, link: "", seq: 0, timer: null };
    $("modalBox").classList.remove("tall");
    $("modalBox").innerHTML = '<div class="modal-bar"></div><button class="pk-x" data-act="closeModal" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="modal-ttl">تعديل اللوكيشن</div><div class="pk-sub">طلب #' + o.bon + " — " + esc(o.name || "") + "</div>" +
      '<div class="lc-pick"><button class="lc-b shop" data-act="lcPick" data-w="shop"><i class="fa-solid fa-store"></i><span>تغيير لوكيشن المحل</span></button><button class="lc-b cust" data-act="lcPick" data-w="cust"><i class="fa-solid fa-house-user"></i><span>تغيير لوكيشن العميل</span></button></div>' +
      '<div class="lc-sec" id="lcForm"><div class="lc-in"><div class="lc-cur" id="lcCur"></div><textarea id="lcInput" rows="2" dir="ltr" placeholder="" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><div class="lc-hint" id="lcHint"></div></div></div>' +
      '<div class="lc-sec" id="lcConf"><div class="lc-in"><button class="act-btn lc-ok" id="lcOk" data-act="lcConfirm"><i class="fa-solid fa-check"></i> <span id="lcOkTxt"></span></button></div></div>';
    $("modalBg").classList.add("show");
  }
  var LC_TXT = { shop: "المحل", cust: "العميل" };
  function lcPick(w) {
    var L = S.lc; if (!L) return; L.which = w;
    document.querySelectorAll(".lc-b").forEach(function (b) { b.classList.toggle("on", b.dataset.w === w); b.classList.toggle("dim", b.dataset.w !== w); });
    var o = orderBy(L.bon), cur = o ? (w === "shop" ? o.sloc : o.cloc) : "", url = mapsUrl(cur) || (w === "shop" ? "https://www.google.com/maps?q=" + STORE_COORDS.lat + "," + STORE_COORDS.lng : "");
    $("lcCur").innerHTML = url ? 'اللوكيشن الحالي لـ' + LC_TXT[w] + ': <a href="' + esc(url) + '" target="_blank" rel="noopener">افتح على الخريطة</a>' : "لا يوجد لوكيشن حالي لـ" + LC_TXT[w];
    var inp = $("lcInput"); inp.placeholder = "قم بإضافة لوكيشن " + LC_TXT[w] + " الجديد"; $("lcOkTxt").textContent = "تأكيد لوكيشن " + LC_TXT[w] + " الجديد";
    $("lcOk").className = "act-btn lc-ok " + w; $("lcForm").classList.add("on"); lcValidate(); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 350);
  }
  function lcValidate() {
    var L = S.lc; if (!L) return; var r = locCheck(L.val), hint = $("lcHint"); L.ok = false; L.link = ""; clearTimeout(L.timer); L.seq++;
    var done = function (ok, cls, html) { L.ok = ok; hint.className = "lc-hint " + cls; hint.innerHTML = html; $("lcConf").classList.toggle("on", ok); };
    if (r.state === "empty") return done(false, "", "");
    if (r.state === "bad") return done(false, "bad", '<i class="fa-solid fa-circle-xmark"></i> لوكيشن غير مفهوم — ألصق لينك خرائط، أو إحداثيات، أو Plus Code');
    if (r.state === "ok") { L.link = r.link; return done(true, "ok", '<i class="fa-solid fa-circle-check"></i> لوكيشن صحيح (<bdi dir="ltr">' + r.lat.toFixed(6) + " , " + r.lng.toFixed(6) + "</bdi>)"); }
    done(false, "wait", '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق من اللينك…');
    var seq = L.seq; L.timer = setTimeout(function () {
      api("resolveLocation", { loc: r.url }).then(function (d) {
        if (!S.lc || S.lc !== L || seq !== L.seq) return;
        if (d && d.status === "success") { L.link = d.link; done(true, "ok", '<i class="fa-solid fa-circle-check"></i> لوكيشن صحيح (' + Number(d.lat).toFixed(6) + " , " + Number(d.lng).toFixed(6) + ")"); }
        else done(false, "bad", '<i class="fa-solid fa-circle-xmark"></i> ' + esc((d && d.message) || "مقدرناش نفهم اللوكيشن ده"));
      }).catch(function () { if (S.lc === L && seq === L.seq) done(false, "bad", '<i class="fa-solid fa-circle-xmark"></i> تعذر التحقق (النت؟) — جرّب تاني'); });
    }, 450);
  }
  function lcConfirm() {
    var L = S.lc; if (!L || !L.ok || !L.which) return; var o = orderBy(L.bon); if (!o) { closeModal(); return; }
    var w = L.which, link = L.link; if (w === "shop") o.sloc = link; else o.cloc = link;
    o.shopEta = ""; o.custEta = ""; o.arrived = false;
    closeModal(); toast("تم تغيير لوكيشن " + LC_TXT[w] + " — جاري إعادة حساب التوصيل", "ok"); rerender();
    enqueue("updateOrderLocation", { bon: o.bon, which: w, loc: link }, "تعذر تغيير لوكيشن " + LC_TXT[w]);
  }

  /* ---------- متابعة الموظفين / المتعاقدين (قريبًا) ---------- */
  var MS_TABS = [["order", "دعم الطلبات"], ["personal", "دعم شخصي"], ["customers", "دعم العملاء"], ["contractors", "دعم المتعاقدين"]];
  var MS_TITLES = { order: "دعم الطلبات", personal: "دعم شخصي", customers: "دعم العملاء", contractors: "دعم المتعاقدين" };
  function renderMonitorStaff() {
    ensureSubNav("ms", MS_TABS, "msTab", S.msTab);
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

  /* ---------- جلب البيانات (مع تجاهل أي رد قديم لو في تعديل اتعمل أثناء الطلب) ---------- */
  function guarded(fn) {
    var seq = S.wseq;
    return function (d) { if (seq !== S.wseq || S.queue.length || S.flushing) return; fn(d); };
  }
  function changed(key, data) { var s = JSON.stringify(data); if (S.sig[key] === s) return false; S.sig[key] = s; return true; }
  function fetchPilots() {
    return api("getPilots").then(guarded(function (d) {
      if (!Array.isArray(d.list)) return;
      if (changed("pilots", d.list) || !S.pilots) { S.pilots = d.list; rerender(); }
    })).catch(netErr);
  }
  function fetchCustomers() {
    return api("getCustomers").then(guarded(function (d) {
      if (!Array.isArray(d.list)) return;
      if (changed("custs", d.list) || !S.custs) { S.custs = d.list; rerender(); }
    })).catch(netErr);
  }
  function fetchActive() {
    return api("getOrdersForAdmin", { phase: "active" }).then(guarded(function (d) {
      if (!Array.isArray(d.list)) return;
      S.lastSync = Date.now();
      if (changed("orders", d.list) || !S.orders) { S.orders = d.list; rerender(); }
    })).catch(netErr);
  }
  function fetchDelivered() {
    return api("getOrdersForAdmin", { phase: "delivered" }).then(guarded(function (d) {
      if (!Array.isArray(d.list)) return;
      if (changed("delivered", d.list) || !S.delivered) { S.delivered = d.list; rerender(); }
    })).catch(netErr);
  }
  function netErr(e) { if (e && ["unauthorized", "suspended", "nourl", "net"].indexOf(e.message) < 0) toast("حدث خطأ غير متوقع", "err"); }
  function rerender() {
    if ($("modalBg").classList.contains("show") && S.pickBon !== null) renderPicker();
    if (S.page === "management" && !S.selected) { if (S.mgmtTab === "pilots") renderMgmtList(); else if (S.mgmtTab === "customers") renderCustList(); }
    else if (S.page === "trackPilots") renderTpBody();
  }
  function refresh(force) {
    if (!force && (S.queue.length || S.flushing)) return Promise.resolve();
    if (S.page === "management" && !S.selected) { if (S.mgmtTab === "customers") return fetchCustomers(); if (S.mgmtTab === "pilots") return fetchPilots(); }
    if (S.page === "trackPilots") {
      var ps = [fetchPilots(), fetchActive()]; if (S.tpTab === "delivered") ps.push(fetchDelivered());
      return Promise.all(ps);
    }
    return Promise.resolve();
  }
  function manualRefresh() {
    var b = $("refBtn"); b.classList.add("spin"); S.sig = {};
    refresh(true).then(function () { b.classList.remove("spin"); }, function () { b.classList.remove("spin"); });
  }
  function checkStatus() { return api("adminStatus").catch(function () {}); }

  function start() {
    if (S.started) return; S.started = true;
    $("drawerFooterVersion").textContent = "إدارة صيدلية عوف v" + (CFG.APP_VERSION || "1.0.0");
    document.querySelectorAll(".drawer-item").forEach(function (el) { el.classList.toggle("on", el.dataset.page === S.page); });
    renderNet(); renderPage(); checkStatus();
    setInterval(function () { if (document.hidden || S.polling) return; S.polling = true; refresh().then(function () { S.polling = false; }, function () { S.polling = false; }); }, CFG.POLL_MS || 10000);
    setInterval(function () { if (!document.hidden) checkStatus(); }, 30000);
  }

  function closeCard() { S.open = null; renderTpBody(); window.scrollTo(0, S.scrollBefore || 0); }

  /* ---------- زرار الرجوع (أندرويد) ---------- */
  function goBack() {
    if ($("modalBg").classList.contains("show")) return closeModal();
    if (drawerOpen()) return closeDrawer();
    if (S.selected) return closeDetail();
    if (S.viewPilot) { S.viewPilot = null; return renderTpBody(); }
    if (S.open !== null) return closeCard();
    if (S.page !== "management") return openPage("management");
    confirmBox("هل تريد الخروج من التطبيق؟", function () { try { window.Capacitor.Plugins.App.exitApp(); } catch (e) {} });
  }

  /* ---------- الأحداث (تفويض) ---------- */
  var ACT = {
    togglePw: function (el) { var i = $(el.dataset.target); var sh = i.type === "password"; i.type = sh ? "text" : "password"; el.innerHTML = '<i class="fa-solid ' + (sh ? "fa-eye-slash" : "fa-eye") + '"></i>'; },
    login: doLogin, register: doRegister,
    showRegister: function () { show("loginScreen", "none"); show("registerScreen", "flex"); },
    showLogin: function () { show("registerScreen", "none"); show("loginScreen", "flex"); },
    logout: forceLogout, openDrawer: openDrawer, closeDrawer: closeDrawer, refresh: manualRefresh, netInfo: netInfo,
    page: function (el) { openPage(el.dataset.page); },
    modalBg: function (el, e) { if (e.target === el) closeModal(); }, closeModal: closeModal,
    confirmYes: function () { var f = S.cfmYes; S.cfmYes = null; S.cfmNo = null; $("modalBg").classList.remove("show"); $("modalBox").classList.remove("tall"); if (f) f(); },
    confirmNo: function () { var f = S.cfmNo; S.cfmYes = null; S.cfmNo = null; if (f) f(); else closeModal(); },
    mgmtTab: function (el) { S.mgmtTab = el.dataset.v; S.mgmtSub = "pending"; S.custSub = "ok"; S.selected = null; S.search = ""; S.custSearch = ""; renderManagement(); window.scrollTo(0, 0); },
    mgmtSub: function (el) { S.mgmtSub = el.dataset.v; setSubBtn("mgmtSub", S.mgmtSub); renderMgmtList(); },
    custSub: function (el) { S.custSub = el.dataset.v; setSubBtn("custSub", S.custSub); renderCustList(); },
    openPilot: function (el) { openPilot(el.dataset.id); }, closeDetail: closeDetail,
    draftReq: function (el) { S.draftReq = el.dataset.v; renderPage(); }, draftPerson: function (el) { S.draftPerson = el.dataset.v; renderPage(); },
    saveStatus: saveStatus, saveInfo: saveInfo,
    editStart: function (el) { S.editing[el.dataset.k] = true; renderPage(); },
    editOk: function (el) { S.editing[el.dataset.k] = false; renderPage(); },
    editNo: function (el) { S.drafts[el.dataset.k] = S.orig[el.dataset.k]; S.editing[el.dataset.k] = false; renderPage(); },
    openCust: function (el) { openCust(el.dataset.id); }, custSet: custSet,
    tpTab: function (el) {
      S.tpTab = el.dataset.v; S.open = null; S.viewPilot = null; setChipOn("tpTab", S.tpTab); renderTpBody(); window.scrollTo(0, 0);
      if (S.tpTab === "delivered") fetchDelivered(); else if (S.tpTab !== "working" && S.tpTab !== "off") fetchActive(); else { fetchPilots(); fetchActive(); }
    },
    viewPilot: function (el) { S.viewPilot = el.dataset.id; S.pwShown = false; renderTpBody(); window.scrollTo(0, 0); },
    pvBack: function () { S.viewPilot = null; renderTpBody(); }, pvPw: function () { S.pwShown = !S.pwShown; renderTpBody(); },
    ocOpen: function (el) { S.scrollBefore = window.scrollY; S.open = Number(el.dataset.bon); renderTpBody(); window.scrollTo(0, 0); },
    ocClose: closeCard,
    invToggle: function (el) { var b = Number(el.dataset.bon); S.inv[b] = !S.inv[b]; el.closest(".inv").classList.toggle("open", !!S.inv[b]); el.querySelector(".inv-title").textContent = S.inv[b] ? "صيدلية عوف" : "افتح الفاتورة"; },
    pickOpen: function (el) { pickOpen(Number(el.dataset.bon)); },
    pickType: function (el) { S.pickType = el.dataset.v; S.pickSel = null; renderPicker(); },
    pickSel: function (el) { S.pickSel = el.dataset.id; renderPicker(); },
    pickConfirm: pickConfirm, pickWithdraw: pickWithdraw,
    lcOpen: function (el) { lcOpen(Number(el.dataset.bon)); }, lcPick: function (el) { lcPick(el.dataset.w); }, lcConfirm: lcConfirm,
    cancelOrder: function (el) { cancelOrder(Number(el.dataset.bon)); },
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
    else if (t.id === "lcInput") { if (S.lc) { S.lc.val = t.value; lcValidate(); } }
    else if (t.id === "regBirthDate") calcAge();
  });
  document.addEventListener("change", function (e) { if (e.target.id === "regBirthDate") calcAge(); if (e.target.dataset && e.target.dataset.model) S.drafts[e.target.dataset.model] = e.target.value; });

  document.addEventListener("DOMContentLoaded", function () {
    if (!CFG.MANAGER_URL) $("cfgWarn").hidden = false;
    renderNet();
    try { var A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; if (A && A.addListener) A.addListener("backButton", goBack); } catch (e) {}
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) navigator.serviceWorker.register("sw.js").catch(function () {});
    if (hasSession()) { show("loginScreen", "none"); start(); }
  });
})();
