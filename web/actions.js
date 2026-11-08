/* ═══════════════════════════════════════════════════════════════════
   web/actions.js — موزّع الأحداث المركزي (بديل onclick="…" المضمّنة)

   لماذا: كل `onclick="foo(1,2)"` في الصفحة يُجبر CSP على السماح
   بـ 'unsafe-inline' لسكربتاتها — أي أن ثغرة XSS واحدة تعني تحكمًا كاملًا.
   هذا الملف يجعل الصفحة تعمل **بلا أي معالج مضمّن**:

       onclick="addToCart(3,5)"      →   data-act="addToCart" data-json="[3,5]"
       onclick="event.stopPropagation(); toggleFav(1,2)"
                                     →   data-act="toggleFav" data-json="[1,2]" data-stop
       oninput="saveField(this.value)" →   data-on="input" data-act="saveField" data-json='["$value"]'
       onkeydown="if(event.key==='Enter')save()"
                                     →   data-on="keydown" data-key="Enter" data-act="save"

   الأمان: لا eval ولا Function ولا تنفيذ نصّي إطلاقًا.
   اسم الدالة يُطابَق بنمط صارم ثم يُبحث في window — وإن لم يكن دالة، لا شيء يحدث.
   الحجج تُقرأ من data-json بـ JSON.parse داخل try/catch.

   ⚠️ يجب أن يُحمَّل هذا الملف قبل بقية وحدات web/ (يُربط على document لا على عناصر).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__actionsBound) return;
  window.__actionsBound = true;

  var NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/;
  var EVENTS = ['click', 'input', 'change', 'keydown', 'blur', 'submit', 'drop', 'dragover', 'dragleave', 'paste'];
  var MAX_DEPTH = 40;

  // حجج ديناميكية: "$value" و"$checked" و"$data:key" تُستبدل من العنصر نفسه
  function dynamic(token, el) {
    if (token === '$value') return el.value;
    if (token === '$checked') return !!el.checked;
    if (token === '$text') return el.textContent;
    if (typeof token === 'string' && token.indexOf('$data:') === 0) return el.dataset[token.slice(6)];
    return token;
  }

  function argsOf(el) {
    var raw = el.getAttribute('data-json');
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) parsed = [parsed];
    for (var i = 0; i < parsed.length; i++) parsed[i] = dynamic(parsed[i], el);
    return parsed;
  }

  /* ── pAct: تسجيل الحجج وقت الرسم (تحفظ أنواعها الحقيقية) ────────────────
     لماذا لا نكتب الحجج في data-json؟ لأن الـHTML نصّ: الرقم يصير نصًّا،
     و"this.value" لا وجود لها وقت الرسم. هنا تُحفظ القيم نفسها في سجلّ
     ويحمل العنصر مفتاحًا قصيرًا فقط. لا eval ولا تفكيك نصّي. */
  var VALUE = {'$sentinel': 'value'};
  var CHECKED = {'$sentinel': 'checked'};
  var EVENT = {'$sentinel': 'event'};
  var registry = Object.create(null);
  var seq = 0, order = [];

  window.__actionsSentinels = {VALUE: VALUE, CHECKED: CHECKED, EVENT: EVENT};

  window.pAct = function (name, args, on) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return '';
    var key = 'a' + (++seq);
    var evt = (typeof on === 'string' && on) ? on : 'click';
    registry[key] = {name: name, args: Array.isArray(args) ? args : [], on: evt};
    order.push(key);
    // سقف صريح: العناصر القديمة تُزال من الـDOM، فلا داعي لنموّ لا نهائي
    if (order.length > 4000) { delete registry[order.shift()]; }
    return ' data-act="' + name + '" data-tok="' + key + '"' + (evt === 'click' ? '' : ' data-on="' + evt + '"');
  };

  // ⚠️ تُعلَّق على pAct نفسها لأن ملفات الوحدات تستخدم pAct.VALUE مباشرة
  window.pAct.VALUE = VALUE;
  window.pAct.CHECKED = CHECKED;
  window.pAct.EVENT = EVENT;

  /** يمنح الحجج وقت التشغيل قيمها الحقيقية (value/checked/event) */
  function realArgs(list, el, ev) {
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a === VALUE) out[i] = el.value;
      else if (a === CHECKED) out[i] = !!el.checked;
      else if (a === EVENT) out[i] = ev;
      else out[i] = a;
    }
    return out;
  }

  function resolve(name) {
    if (!name || !NAME_RE.test(name)) return null;
    var fn = window[name];
    return typeof fn === 'function' ? fn : null;
  }

  // البحث عن أقرب عنصر يحمل data-act — يتحمل إعادة رسم innerHTML بالكامل
  function source(el) {
    var depth = 0;
    while (el && el !== document && depth++ < MAX_DEPTH) {
      if (el.getAttribute && el.getAttribute('data-act')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function onEvent(ev) {
    var el = source(ev.target);
    if (!el) return;
    var tokEl = el.getAttribute('data-tok');
    var entryEl = tokEl ? registry[tokEl] : null;
    var want = el.getAttribute('data-on') || (entryEl && entryEl.on) || 'click';
    if (want !== ev.type) return;

    // شروط مسبقة بلا كود: مفتاح محدّد، أو قيمة حقل غير فارغة
    var key = el.getAttribute('data-key');
    if (key && ev.type === 'keydown' && ev.key !== key) return;
    if (el.hasAttribute('data-nonempty') && !String(el.value || '').trim()) return;

    var fn = resolve(el.getAttribute('data-act'));
    if (!fn) {
      // لا نُفشل بصمت مطلقًا: نُسجّل مرة واحدة لتسهيل التتبع
      if (window.console && console.warn) console.warn('[actions] دالة غير معروفة:', el.getAttribute('data-act'));
      return;
    }
    if (el.hasAttribute('data-stop')) ev.stopPropagation();
    if (el.hasAttribute('data-prevent')) ev.preventDefault();
    try {
      var tok = el.getAttribute('data-tok');
      var entry = tok ? registry[tok] : null;
      var args = entry ? realArgs(entry.args, el, ev) : argsOf(el);
      // data-event: بعض الدوال تحتاج الحدث نفسه أولًا (importData(event)…)
      if (el.hasAttribute('data-event')) args = [ev].concat(args);
      fn.apply(el, args.concat([ev, el]));
    } catch (err) {
      if (window.console && console.error) console.error('[actions]', el.getAttribute('data-act'), err);
    }
  }

  for (var i = 0; i < EVENTS.length; i++) {
    document.addEventListener(EVENTS[i], onEvent, EVENTS[i] === 'blur' ? true : false);
  }

  // للاختبارات والفحص: عرض ما سيُنفَّذ دون تنفيذ
  window.__actionsProbe = function (el) {
    var tok = el.getAttribute('data-tok');
    var entry = tok ? registry[tok] : null;
    return {
      act: el.getAttribute('data-act'),
      args: entry ? entry.args : argsOf(el),
      on: el.getAttribute('data-on') || (entry && entry.on) || 'click',
      fromToken: !!entry,
      known: !!resolve(el.getAttribute('data-act')),
    };
  };
})();
