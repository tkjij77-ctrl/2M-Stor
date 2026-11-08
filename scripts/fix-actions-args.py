"""T7.4/د — إصلاح حجج pAct التي خرجت حرفية من التحويل الآلي.

المشكلة: مُحوِّل pass1 كان يقسّم كود المعالج على الفواصل ثم يغلّف كل قطعة
كنصّ، فصار:
    onclick="proProductEdit(' + r.ci + ',' + r.ii + ')"
يُحوَّل إلى:
    pAct("proProductEdit", [" + r.ci + ", " + r.ii + "], "click")
وهي صحيحة نحويًا لكن **خاطئة سلوكيًا**: الحجج نصوص حرفية لا أرقام.
الإصلاح: داخل مصفوفة الحجج فقط، كل نصّ على هيئة " + تعبير + " يُردّ تعبيرًا.
"""
import re, sys, json

CAMEL = re.compile(r'\bpAct\(')
CHARGE = re.compile(r'\bregisterAct\(')
QS = re.compile(r'(?<![\w$])act\(')          # دالة مساعدة إن وُجدت

def mask(src):
    """قناع للسلاسل والتعليقات حتى لا نلتقط أقواسًا داخلها."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            q = c
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i+1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i+1] == '*':
            j = src.find('*/', i + 2)
            i = (j + 2) if j >= 0 else n
            continue
        i += 1
    # لا نُعيد القناع نفسه؛ نُعيد دالة تحديد ما إذا كان الموضع داخل نصّ
    return None

def string_map(src):
    """يعيد قاموس موضع→True لكل محرف يقع داخل نصّ/تعليق."""
    inside = [False] * (len(src) + 1)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            q = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    inside[i] = True
                    if i + 1 < n: inside[i+1] = True
                    i += 2
                    continue
                if src[i] == q:
                    break
                inside[i] = True
                i += 1
            i += 1
            inside[start] = True
            continue
        if c == '/' and i + 1 < n and src[i+1] == '/':
            while i < n and src[i] != '\n':
                inside[i] = True
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i+1] == '*':
            j = src.find('*/', i + 2)
            j = (j + 2) if j >= 0 else n
            for k in range(i, j):
                inside[k] = True
            i = j
            continue
        i += 1
    return inside

def strip_plus(txt):
    t = txt.strip()
    t = re.sub(r'^\+\s*', '', t)
    t = re.sub(r'\s*\+$', '', t)
    return t.strip()

BRACKET_ARG = re.compile(r'\[\s*$')
BROKEN = re.compile(r'"(\s*\+\s*[^"\\]*?\s*\+\s*)"')

def find_arg_array(src, inside, open_paren):
    """من قوس pAct( نجد قوس المصفوفة الأول المستوى ثم نهايته."""
    depth = 0
    i = open_paren
    n = len(src)
    # تخطّي اسم الدالة
    while i < n and src[i] != '(':
        i += 1
    depth = 0
    while i < n:
        c = src[i]
        if not inside[i]:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0:
                    return None
            elif c == '[' and depth == 1:
                # بداية الحجج
                start = i
                d = 0
                j = i
                while j < n:
                    if not inside[j]:
                        if src[j] == '[':
                            d += 1
                        elif src[j] == ']':
                            d -= 1
                            if d == 0:
                                return (start, j)
                    j += 1
                return None
        i += 1
    return None

def repair(src):
    inside = string_map(src)
    spans = []
    for m in CAMEL.finditer(src):
        # مفتاح pAct داخل نصّ؟ تخطَّ
        if inside[m.start()]:
            continue
        span = find_arg_array(src, string_map(src), m.start())
        if span:
            spans.append(span)
    # من النهاية للبداية حتى لا تتزحزح المواضع
    fixed = 0
    for (a, b) in sorted(spans, reverse=True):
        seg = src[a:b+1]
        new, n = BROKEN.subn(lambda mm: strip_plus(mm.group(1)), seg)
        if n:
            src = src[:a] + new + src[b+1:]
            fixed += n
    return src, fixed

if __name__ == '__main__':
    total = 0
    for path in sys.argv[1:]:
        s = open(path, encoding='utf-8').read()
        out, n = repair(s)
        if n:
            open(path, 'w', encoding='utf-8').write(out)
        print(f'{path}: أُصلح {n}')
        total += n
    print('الإجمالي:', total)
