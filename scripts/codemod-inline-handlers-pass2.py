#!/usr/bin/env python3
"""T7.4 — المرور الثاني: المعالجات متعدّدة العبارات تُغلَّف بدوال مسمّاة."""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location('cod', 'scripts/codemod-inline-handlers.py')
cod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cod)

PATH = sys.argv[1] if len(sys.argv) > 1 else 'web/pro-admin.js'

# (الكود المفكوك) → (اسم الدالة، الحجج بتعبير JS)
MANUAL = {
    "proSetSetting('brandColor',this.value);proApplyBranding();proAdminRender()":
        ("proSettingBrandColor", ["pAct.VALUE"]),
    "proSetSetting('logo','');proAdminRender()":
        ("proSettingLogoClear", []),
    "proSetSetting('brandColor','' + c + '');proApplyBranding();proAdminRender()":
        ("proSettingBrandColor", ["c"]),
    "setRolePerm('' + role + '','' + k[0] + '',this.checked);setTimeout(proAdminRender,120)":
        ("proRolePerm", ["role", "k[0]", "pAct.CHECKED"]),
    "proAdminState.editing=null;proAdminState.form=null;proAdminRender()":
        ("proBannerFormClear", []),
    "proAdminState.form.image_url='';proAdminRender()":
        ("proBannerImageClear", []),
    "proAdminState.form.link_value=this.value": ("proBannerField", ['"link_value"', "pAct.VALUE"]),
    "proAdminState.form.link_type=this.value": ("proBannerField", ['"link_type"', "pAct.VALUE"]),
    "proAdminState.form.emoji=this.value": ("proBannerField", ['"emoji"', "pAct.VALUE"]),
    "proAdminState.form.cta_text=this.value": ("proBannerField", ['"cta_text"', "pAct.VALUE"]),
    "proAdminState.form.subtitle=this.value": ("proBannerField", ['"subtitle"', "pAct.VALUE"]),
    "proAdminState.form.title=this.value": ("proBannerField", ['"title"', "pAct.VALUE"]),
    "proAdminState.prodCat=this.value;proAdminRender()":
        ("proAdminFilterCat", ["pAct.VALUE"]),
    "proAdminState.prodQ=this.value;clearTimeout(window.__proPq);window.__proPq=setTimeout(proAdminRender,240)":
        ("proAdminSearchProd", ["pAct.VALUE"]),
    "proAdminState.orderQ=this.value;clearTimeout(window.__proOq);window.__proOq=setTimeout(proAdminRender,260)":
        ("proAdminSearchOrder", ["pAct.VALUE"]),
    "proCloseAdmin();showInvoiceHistory()": ("proCloseAdminInvoices", []),
    "proCloseAdmin();toggleDashboard()": ("proCloseAdminDashboard", []),
    "proCloseAdmin();setView('shop')": ("proCloseAdminShop", []),
    "proCloseAdmin();logout()": ("proCloseAdminLogout", []),
}

src = open(PATH, encoding='utf-8').read()
handlers = cod.find_handlers(src)
done, unknown = 0, []

for start, end, ev, raw, term in reversed(handlers):
    code = cod.decode(raw).strip()
    if code not in MANUAL:
        # معالج لم يُتَرجَم ولم يُغطَّ في الجدول
        stmts = [s for s in cod.split_top(code, ';') if s.strip()]
        if len(stmts) > 1:
            unknown.append(code)
        continue
    name, args = MANUAL[code]
    repl = "' + pAct(\"%s\", [%s], \"%s\") + '" % (name, ', '.join(args), ev)
    src = src[:start] + repl + src[end:]
    done += 1

open(PATH, 'w', encoding='utf-8').write(src)
import re
left = len(re.findall(r'\bon(?:click|input|change|keydown|blur|submit)=', src))
print(f'{PATH}: غُلِّف {done} · متبقٍ {left}')
if unknown:
    print('⚠️ معالجات متعدّدة بلا غلاف:')
    for u in unknown:
        print('  ', u[:140])
