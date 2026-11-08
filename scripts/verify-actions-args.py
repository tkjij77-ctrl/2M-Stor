#!/usr/bin/env python3
"""T7.4 — بوّابة سلامة الحجج والأسماء في موزّع الأحداث (pAct / data-act).

سبب وجودها: التحويل الآلي من onclick إلى data-act أخرج — في 34 موضعًا —
حججًا **حرفية** بدل تعبيرات:
    pAct("proProductEdit", [" + r.ci + ", " + r.ii + "], "click")
صحيحة نحويًا، خاطئة سلوكيًا (تُمرِّر نصًّا مكان رقم)، ولا يكتشفها أي اختبار
واجهة لأنه لا يتحقق من قيم الحجج. هذه البوّابة تُفشل البناء إن عادت.

الفحوص:
  1) لا حجج pAct على هيئة نصّ فيه + في الطرفين  (لا بقايا " + x + ")
  2) كل اسم في data-act / pAct("…") معرّف فعلًا (function / window.x / let|const)
  3) لا eval ولا new Function داخل web/ (شرط CSP الصارم)
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / 'web').glob('*.js')) + [ROOT / 'index.html']

fails = []
stats = {'pact': 0, 'acts': 0, 'names': set(), 'eval': 0}


def strip_comments(src: str) -> str:
    """يحيّد التعليقات (يُبقي الأسطر) حتى لا تُحسب أمثلة التوثيق أعطالًا."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '"\'':
            q, j = c, i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    j += 1
                    break
                j += 1
            out.append(src[i:j])
            i = j
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = (j + 2) if j >= 0 else n
            out.append('\n' * src.count('\n', i, j))
            i = j
            continue
        out.append(c)
        i += 1
    return ''.join(out)


DECLARED = []
for p in sorted((ROOT / 'web').glob('*.js')):
    src = strip_comments(p.read_text(encoding='utf-8'))
    DECLARED.append(src)
    # 3) لا eval / new Function
    for m in re.finditer(r'(?<![\w$])eval\s*\(|new\s+Function\s*\(', src):
        stats['eval'] += 1
        fails.append(f'{p.name}: eval/Function عند الموضع {m.start()}')

DECLS = '\n'.join(DECLARED)

for p in FILES:
    raw = p.read_text(encoding='utf-8')
    src = strip_comments(raw)

    # 1) حجج حرفية معطوبة
    for m in re.finditer(r'\bpAct\(\s*"([A-Za-z_$][\w$]*)"\s*,\s*\[([^\]]*)\]', src):
        stats['pact'] += 1
        stats['names'].add(m.group(1))
        body = m.group(2)
        for lit in re.finditer(r'"([^"\\]*)"', body):
            txt = lit.group(1)
            if re.match(r'^\s*\+', txt) or re.search(r'\+\s*$', txt):
                line = src.count('\n', 0, m.start()) + 1
                fails.append(f'{p.name}:{line}: حجة حرفية معطوبة «{txt}» في {m.group(1)}')

    # 2) الأسماء
    for m in re.finditer(r'data-act="([A-Za-z_$][\w$]*)"', src):
        stats['acts'] += 1
        stats['names'].add(m.group(1))
    for m in re.finditer(r"' \+ pAct\(\"([A-Za-z_$][\w$]*)\"", src):
        stats['names'].add(m.group(1))

for name in sorted(stats['names']):
    pat = re.escape(name)
    if re.search(r'function\s+' + pat + r'\s*\(', DECLS):
        continue
    if re.search(r'(?:window\.)?' + pat + r'\s*=\s*(?:async\s*)?(?:function|\()', DECLS):
        continue
    if re.search(r'\b(?:let|const|var)\s+' + pat + r'\s*=', DECLS):
        continue
    fails.append(f'اسم مستهدف غير معرّف: {name}')

print(f'• pAct: {stats["pact"]} · data-act: {stats["acts"]} · أسماء فريدة: {len(stats["names"])}')
print(f'• eval/Function: {stats["eval"]} (يجب 0)')

if fails:
    print('\n❌ عيوب:')
    for f in fails:
        print('  -', f)
    sys.exit(1)

print('\n✅ سلامة الحجج والأسماء: لا حجج معطوبة، كل الأسماء معرّفة، بلا eval.')
