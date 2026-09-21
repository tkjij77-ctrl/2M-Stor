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
    check("CodeQL: تهيئة + تحليل", "github/codeql-action/init@v3" in uses)
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
src = IDX.read_text(encoding="utf-8")
html_part, _, css_js = src.partition("<script>")
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
