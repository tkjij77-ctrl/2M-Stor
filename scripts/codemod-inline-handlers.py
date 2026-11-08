#!/usr/bin/env python3
"""T7.4 — محوّل onclick/oninput/onchange → pAct (web/actions.js)

يعمل على ملفات web/*.js التي تبني HTML داخل نصوص JS مفردة التنصيص.
لا يخمّن الأنواع: الحجج تُسجَّل وقت الرسم عبر pAct فتحفظ نوعها الحقيقي.
المعالجات المتعدّدة العبارات تُترك للمراجعة اليدوية (تُطبع في التقرير).
"""
import json
import re
import sys

EVENTS = ('click', 'input', 'change', 'keydown', 'blur', 'submit')

CALL_RE = re.compile(r'^([A-Za-z_$][\w$.]*)\s*\((.*)\)$', re.S)


def find_handlers(src):
    """يُعيد [(start, end, event, content_source)] لكل معالج مضمّن."""
    out = []
    i = 0
    n = len(src)
    while i < n:
        m = re.compile(r'on(click|input|change|keydown|blur|submit)=').search(src, i)
        if not m:
            break
        j = m.end()
        if src.startswith('\\"', j):
            j += 1
            term = '\\"'
        elif src.startswith('"', j):
            term = '"'
        else:
            i = m.end()
            continue
        start_content = j + 1  # بعد علامة الفتح
        k = start_content
        while k < n:
            if src.startswith('\\"', k):
                end_content = k
                end_attr = k + 2
                break
            if src[k] == '"':
                end_content = k
                end_attr = k + 1
                break
            k += 1
        else:
            break
        out.append((m.start(), end_attr, m.group(1), src[start_content:end_content], term))
        i = end_attr
    return out


def decode(raw):
    return raw.replace("\\'", "'").replace('\\"', '"')


def split_top(s, sep=','):
    parts, depth, cur, q = [], 0, '', None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
            continue
        if ch in "'\"":
            q = ch
            cur += ch
        elif ch in '([{':
            depth += 1
            cur += ch
        elif ch in ')]}':
            depth -= 1
            cur += ch
        elif ch == sep and depth == 0:
            parts.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def to_js_arg(a):
    """يحوّل حجّة (نصّ JS بعد فكّ الترميز) إلى تعبير JS آمن وقت الرسم."""
    a = a.strip()
    if a == 'this.value':
        return 'pAct.VALUE'
    if a == 'this.checked':
        return 'pAct.CHECKED'
    if a == 'event':
        return 'pAct.EVENT'
    if re.fullmatch(r"-?\d+(\.\d+)?", a):
        return a
    if re.fullmatch(r"'(?:[^'\\]|\\.)*'", a) or re.fullmatch(r'"(?:[^"\\]|\\.)*"', a):
        # نصّ حرفي: نُخرجه كـJSON حتى يبقى حرفيًا في الكود
        return json.dumps(a[1:-1], ensure_ascii=False)
    return '(' + a + ')'


def main(path, dry=False):
    src = open(path, encoding='utf-8').read()
    handlers = find_handlers(src)
    replaced, manual = 0, []

    # نعالج من النهاية للبداية كي لا تتغيّر المواضع
    for start, end, ev, raw, term in reversed(handlers):
        code = decode(raw).strip()
        stmts = [s.strip() for s in split_top(code, ';') if s.strip()]
        if len(stmts) > 1:
            manual.append((ev, code, raw))
            continue
        m = CALL_RE.match(stmts[0])
        if not m:
            manual.append((ev, code, raw))
            continue
        name, args_s = m.group(1), m.group(2)
        args = [to_js_arg(a) for a in split_top(args_s)] if args_s.strip() else []
        repl = "' + pAct(\"%s\", [%s], \"%s\") + '" % (name, ', '.join(args), ev)
        src = src[:start] + repl + src[end:]
        replaced += 1

    if not dry:
        open(path, 'w', encoding='utf-8').write(src)

    left = len(re.findall(r'\bon(?:click|input|change|keydown|blur|submit)=', src))
    print(f'{path}: حُوِّل {replaced} · يدوي {len(manual)} · متبقٍ {left}')
    for ev, code, raw in manual:
        print(f'   ✋ on{ev}: {code[:110]}')
    return manual


if __name__ == '__main__':
    main(sys.argv[1], dry='--dry' in sys.argv)
