#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════
#  T2.3 — فاحص إعدادات الحوكمة الأمنية
#  يتأكد أن: Dependabot يراقب التبعيات · CodeQL يفحص كل دفع ·
#  CI فيه بوابة ثغرات · كل actions مثبّتة على وسم (لا فرع متغيّر).
#  التشغيل:  python3 scripts/verify-ci-config.py
#  ملاحظة: ملفات YAML صحيحة بنيويًا لا تعني أنها تعمل — لذلك يتحقق
#  هذا الفاحص من الخصائص الأمنية المطلوبة نصًّا، لا من الشكل فقط.
# ═══════════════════════════════════════════════════════════════════
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("❌ يحتاج pyyaml:  pip install pyyaml")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"
DEP = ROOT / ".github" / "dependabot.yml"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))


def load(path):
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as e:
        check(f"قراءة {path.name}", False, str(e)[:70])
        return None


# ── 1) وجود الملفات ──
check("ملف Dependabot موجود", DEP.exists())
check("workflow CodeQL موجود", (WF / "codeql.yml").exists())

# ── 2) Dependabot ──
dep = load(DEP) if DEP.exists() else None
if dep:
    updates = dep.get("updates") or []
    ecosystems = [u.get("package-ecosystem") for u in updates]
    check("Dependabot: version 2", dep.get("version") == 2)
    check("Dependabot يراقب npm", "npm" in ecosystems, " / ".join(str(e) for e in ecosystems))
    check(
        "Dependabot يراقب إجراءات GitHub",
        "github-actions" in ecosystems,
        "إجراء قديم = ثغرة تبقى سنوات",
    )
    check(
        "كل الأنظمة لها جدول دوري",
        all(u.get("schedule", {}).get("interval") for u in updates),
    )
    unknown = set()
    allowed = {
        "package-ecosystem", "directory", "schedule", "open-pull-requests-limit",
        "versioning-strategy", "labels", "commit-message", "groups", "ignore",
        "allow", "reviewers", "assignees", "target-branch", "rebase-strategy",
        "registries", "milestone", "vendor", "insecure-external-code-execution",
    }
    for u in updates:
        unknown |= set(u) - allowed
    check("لا مفاتيح غير معروفة في dependabot.yml", not unknown, ", ".join(sorted(unknown)))

# ── 3) CodeQL ──
cq_text = (WF / "codeql.yml").read_text(encoding="utf-8") if (WF / "codeql.yml").exists() else ""
cq = load(WF / "codeql.yml") if cq_text else None
if cq:
    job = (cq.get("jobs") or {}).get("analyze") or {}
    steps = job.get("steps") or []
    uses = [str(s.get("uses", "")) for s in steps]
    perms = job.get("permissions") or {}
    trig = cq.get("on") or cq.get(True) or {}
    if isinstance(trig, list):
        trig = {k: None for k in trig}
    check("CodeQL: صلاحية رفع النتائج", perms.get("security-events") == "write")
    # ⚠️ لا نُثبّت رقم الإصدار في الفحص: Dependabot يرقّي هذه الإجراءات دوريًا،
    # وتثبيت الرقم هنا يجعل ترقية مشروعة تُفشل CI (ويُغري بتعطيل الفحص).
    check(
        "CodeQL: تهيئة + تحليل",
        any(re.fullmatch(r"github/codeql-action/init@v\d+", u) for u in uses)
        and any(re.fullmatch(r"github/codeql-action/analy[sz]e@v\d+", u) for u in uses),
    )
    check(
        "CodeQL: خطوة التحليل",
        any(u.startswith("github/codeql-action/analyze@") for u in uses),
    )
    check(
        "CodeQL: يعمل على كل دفع وطلب دمج",
        "push" in trig and "pull_request" in trig,
        " · ".join(trig.keys()),
    )
    check(
        "CodeQL: فحص دوري مجدول",
        "schedule" in trig,
        "يلتقط الثغرات المكتشفة بقواعد جديدة",
    )
    check(
        "CodeQL: يفحص JavaScript/TypeScript",
        "javascript-typescript" in cq_text,
    )
    check(
        "CodeQL: صلاحيات الجلب للقراءة فقط",
        (cq.get("permissions") or {}).get("contents") == "read",
    )

# ── 4) CI: بوابة ثغرات الحزم ──
ci_text = (WF / "ci.yml").read_text(encoding="utf-8") if (WF / "ci.yml").exists() else ""
ci = load(WF / "ci.yml") if ci_text else None
if ci:
    jobs = ci.get("jobs") or {}
    audit = jobs.get("security-audit") or {}
    audit_runs = " ".join(str(s.get("run", "")) for s in (audit.get("steps") or []))
    check("CI: مهمة فحص ثغرات الحزم موجودة", bool(audit), "security-audit")
    check(
        "CI: الفحص يفشل عند ثغرة عالية/حرجة",
        "npm audit" in audit_runs and "audit-level=high" in audit_runs,
    )
    check("CI: مهمة البناء موجودة", "build" in jobs)

    # ── 4-ب) 🔴 عطل حقيقي: `secrets` داخل `if:` يُبطل ملف الـworkflow كله ──
    # GitHub يرفض الملف عند الفحص: "Unrecognized named-value: 'secrets'"،
    # ويفشل التشغيل **قبل إنشاء أي مهمة** (0 jobs · صفر سجلات) — أي CI ميت
    # بلا أثر يمكن تشخيصه. يجب استخدام بوابة GITHUB_OUTPUT بدلًا منها.
    # هذا الفحص يمنع عودته إلى أي ملف workflow في المستودع.
    secret_if = []
    for f in sorted(WF.glob("*.yml")):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"\s*(if|elif)\s*:", line) and "secrets." in line:
                secret_if.append(f"{f.name}:{i}")
    check(
        "لا استخدام لـsecrets داخل if (يُبطل الـworkflow كله)",
        not secret_if,
        " · ".join(secret_if[:3]),
    )

    # ── 4-ج) كل بوابة تحتاج مخرجًا فعليًا + خطوة تتخطّى بوضوح ──
    build_job = jobs.get("build") or {}
    build_env = (build_job.get("steps") or [{}])[-1].get("env") or {}
    check(
        "CI: البناء يمتلك بديلًا لمتغيرات Supabase (لا يفشل بلا أسرار)",
        any("placeholder" in str(v) for v in build_env.values()),
    )

# ── 5) تثبيت الإجراءات (لا فرع متغيّر) ──
bad_refs = []
for f in sorted(WF.glob("*.yml")):
    for m in re.finditer(r"uses:\s*([^\s#]+)", f.read_text(encoding="utf-8")):
        ref = m.group(1)
        if ref.startswith("./"):
            continue
        if "@" not in ref:
            bad_refs.append(f"{f.name}:{ref}")
            continue
        tag = ref.split("@", 1)[1]
        if not re.fullmatch(r"v?\d+(\.\d+)*", tag):  # main · master · latest …
            bad_refs.append(f"{f.name}:{ref}")
check(
    "كل الإجراءات مثبّتة على وسم إصدار",
    not bad_refs,
    ", ".join(bad_refs[:3]),
)

# ── 6) النوافذ: كل عنصر يُفتح بـclassList.add('open') له قاعدة CSS فعلية ──
# سبب الفحص: showLegal() كانت تضيف الكلاس 'open' إلى #modal بينما لا وجود
# لقاعدة .modal-overlay.open في CSS ⇒ المحتوى القانوني لم يكن يظهر إطلاقًا،
# وفحص النص المرئي لا يكشفه لأن innerText يعيد النص للعنصر غير المُصيَّر.
IDX = ROOT / "index.html"
# 🧩 T5.1: كود التطبيق انتقل من داخل index.html إلى web/*.js — الفحص يجب أن يقرأ
# الاثنين معًا، وإلا صار يمرّ فراغًا (لا يجد أي classList.add فينعدم الفحص فعلًا).
WEB = ROOT / "web"
src = IDX.read_text(encoding="utf-8") + "".join(f.read_text(encoding="utf-8") for f in sorted(WEB.glob("*.js"))) if WEB.is_dir() else IDX.read_text(encoding="utf-8")
html_part_keep, _, _ = IDX.read_text(encoding="utf-8").partition("<script")
html_part, _, css_js = src.partition("<script>")  # css_js بلا معنى الآن؛ يُستخدم src كمصدر كامل للبحث
opened = set(re.findall(r"getElementById\('([A-Za-z0-9_-]+)'\)\.classList\.add\('open'\)", src))
broken = []
for el_id in sorted(opened):
    m = re.search(r'<[a-z]+[^>]*id="' + re.escape(el_id) + r'"[^>]*>', html_part)
    if not m:
        m = re.search(r'<[a-z]+[^>]*class="[^"]*"[^>]*id="' + re.escape(el_id) + r'"', html_part)
    classes = re.findall(r'class="([^"]+)"', m.group(0)) if m else []
    ok = False
    for cls in classes:
        for c in cls.split():
            if re.search(r"\." + re.escape(c) + r"\.open\s*\{", html_part) or \
               re.search(r"\." + re.escape(c) + r"\.open\s*\{", css_js):
                ok = True
    if not ok:
        broken.append(el_id)
check(
    "كل نافذة تُفتح بـ«open» لها قاعدة CSS (وإلا لا تظهر إطلاقًا)",
    not broken,
    ", ".join(broken) if broken else f"{len(opened)} نافذة",
)

# ═══════════════════════════════════════════════════════════════════
#  T7.1/T7.2 (2026-11-07) — الفحوصات الحقيقية ليست في CI؟ إذًا لا حماية.
#  الدرس من ثغرتي SEC-1/SEC-2: كانت RLS سليمة والثغرة في صلاحيات الأعمدة،
#  وكل فحص يكشفها كان يعمل **محليًا فقط**. هذه البوابات تمنع تكرار ذلك.
# ═══════════════════════════════════════════════════════════════════
ci_raw = (WF / "ci.yml").read_text(encoding="utf-8") if (WF / "ci.yml").exists() else ""


def job_block(name: str) -> str:
    """يستخرج نص مهمة واحدة من ci.yml (حتى بداية مهمة أخرى)."""
    m = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:\n|\Z)", ci_raw, re.S | re.M)
    return m.group(1) if m else ""


db_job = job_block("db-verify")
check("CI: مهمة db-verify موجودة (بوابة قاعدة البيانات)", bool(db_job.strip()), "" if db_job.strip() else "غير موجودة")
check(
    "CI: db-verify تثبيت PostgreSQL 17 (نفس الإصدار المُختبَر)",
    bool(re.search(r"postgresql-17", db_job)),
    "" if re.search(r"postgresql-17", db_job) else "لا تثبيت لإصدار 17",
)
check(
    "CI: db-verify تُشغّل محاكي pg_net (وإلا لا يُبنى النظام كاملًا)",
    "pg-net-stub.sh" in db_job,
    "" if "pg-net-stub.sh" in db_job else "بدون المحاكي يفشل ترحيل الإشعارات",
)
check(
    "CI: db-verify تُشغّل verify-sql-live.sh (RLS · المخزون · SEC-1/SEC-2)",
    "verify-sql-live.sh" in db_job,
    "" if "verify-sql-live.sh" in db_job else "الفحص غير مربوط بالـPR",
)

ui_job = job_block("ui-verify")
check("CI: مهمة ui-verify موجودة (بوابة الواجهة)", bool(ui_job.strip()), "" if ui_job.strip() else "غير موجودة")
check(
    "CI: ui-verify تُشغّل فحص إسقاط المخزون في متصفح حقيقي",
    "verify-stock-projection-ui.js" in ui_job,
    "" if "verify-stock-projection-ui.js" in ui_job else "فحص SEC-1/SEC-2 مقطوع",
)
check(
    "CI: ui-verify تُشغّل فحص حماية /admin على خادم إنتاجي",
    "verify-next-admin-guard.js" in ui_job,
    "" if "verify-next-admin-guard.js" in ui_job else "حماية اللوحة غير مُختبرة في CI",
)
check("سكربت محاكي pg_net موجود في المستودع", (ROOT / "scripts" / "pg-net-stub.sh").exists())

# ── T7.2: لا يُعاد «الفشل المفتوح» في /admin ──
mw_path = ROOT / "middleware.ts"
mw = mw_path.read_text(encoding="utf-8") if mw_path.exists() else ""
check(
    "T7.2: middleware يستخدم قرار الوصول المشترك (لا شرط محلي)",
    "decideAdminAccess" in mw,
    "" if "decideAdminAccess" in mw else "منطق الدور غير موحَّد",
)
check(
    "T7.2: لا وجود لنمط الفشل المفتوح `if (profile && …)`",
    not re.search(r"profile\s*&&\s*!", mw),
    "" if not re.search(r"profile\s*&&\s*!", mw) else "عاد الشرط الذي يسمح لمن لا سجل له",
)
check(
    "T7.2: طبقة ثانية على السيرفر (app/admin/layout.tsx)",
    (ROOT / "app" / "admin" / "layout.tsx").exists(),
    "" if (ROOT / "app" / "admin" / "layout.tsx").exists() else "الحماية في middleware وحدها",
)
gate_path = ROOT / "tests" / "unit" / "middleware-admin-gate.test.ts"
gate = gate_path.read_text(encoding="utf-8") if gate_path.exists() else ""
check(
    "T7.2: اختبار انحدار يغطي «بلا صف في profiles»",
    "بلا صف في profiles" in gate,
    "" if "بلا صف في profiles" in gate else "الثغرة بلا اختبار يحرسها",
)
guard = (ROOT / "scripts" / "verify-next-admin-guard.js")
gt = guard.read_text(encoding="utf-8") if guard.exists() else ""
check(
    "T7.2: فحص المتصفح يجرّب جلسة مزيّفة",
    "جلسة مزيّفة" in gt,
    "" if "جلسة مزيّفة" in gt else "لا اختبار لكوكي مزوّر",
)
check(
    "ADR-0001: قرار الاستضافة موثَّق في docs/adr",
    any((ROOT / "docs" / "adr").glob("0001-*.md")) if (ROOT / "docs" / "adr").exists() else False,
)
check(
    "ADR-0001: _headers موجود في جذر المستودع (ترويسات السطح الثابت)",
    (ROOT / "_headers").exists(),
    "" if (ROOT / "_headers").exists() else "السطح الحقيقي بلا CSP/XFO",
)
check(
    "ADR-0001: فحص تطابق الترويسات مربوط بـCI",
    "verify-static-headers.js" in ci_text,
    "" if "verify-static-headers.js" in ci_text else "انحراف الترويسات لن يُكتشف",
)
check(
    "T7.4: موزّع الأحداث web/actions.js موجود ومحمَّل أولًا",
    (ROOT / "web" / "actions.js").exists()
    and (ROOT / "index.html").read_text(encoding="utf-8").find("web/actions.js")
        < (ROOT / "index.html").read_text(encoding="utf-8").find("web/core.js"),
    "" if (ROOT / "web" / "actions.js").exists() else "الموزّع غائب",
)
check(
    "T7.4: ملف سقف المعالجات المضمّنة موجود",
    (ROOT / "scripts" / "inline-handlers-budget.json").exists(),
)
check(
    "T7.4: فحص لوحة الإدارة مربوط بـCI",
    "verify-pro-admin-ui.js" in ci_text,
    "" if "verify-pro-admin-ui.js" in ci_text else "اللوحة قد تتعطّل بلا إنذار",
)
check(
    "T7.4: فحص سلامة الحجج/الأسماء موجود",
    (ROOT / "scripts" / "verify-actions-args.py").exists(),
)
check(
    "T7.4: فحص سلامة الحجج/الأسماء مربوط بـCI",
    "verify-actions-args.py" in ci_text,
    "" if "verify-actions-args.py" in ci_text else "الحجج المعطوبة قد تعود بصمت",
)
check(
    "T7.4: فحص السقف مربوط بـCI",
    "verify-inline-handlers.js" in ci_text,
    "" if "verify-inline-handlers.js" in ci_text else "الدَّين قد ينمو بصمت",
)

# ── التقرير ──
print("═══════════════════════════════════════════════════════════════")
print("  T2.3 — فحص إعدادات الحوكمة (Dependabot · CodeQL · CI)")
print("═══════════════════════════════════════════════════════════════")
passed = sum(1 for _, ok, _ in results if ok)
for name, ok, detail in results:
    line = f"  {'✅' if ok else '❌'} {name}"
    if detail:
        line += f"  → {detail}"
    print(line)
print("─" * 63)
print(f"  النتيجة: {passed}/{len(results)} فحصًا ناجحًا")
sys.exit(0 if passed == len(results) else 1)
