#!/usr/bin/env python3
"""T7.4/د — المرور الثاني على web/views.js: المعالجات المركّبة → pAct بأغلفة مسمّاة.

يعمل على النصّ المصدر (بعد المرور الأول) لأن هذه المعالجات تحتوي فواصل منقوطة
أو منطقًا لا يُختصر إلى نداء واحد. كل قاعدة هنا صريحة ومراجَعة يدويًا.
"""
import importlib.util
import re
import sys

spec = importlib.util.spec_from_file_location('cod', 'scripts/codemod-inline-handlers.py')
cod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cod)

PATH = sys.argv[1] if len(sys.argv) > 1 else 'web/views.js'

# (نمط على النصّ المصدر الخام، بديل JS يُنتج pAct)
RULES = [
    (r"event\.stopPropagation\(\);addToCart\('\+ci\+','\+ii\+'\);toast\(\\'[^\\]*\\'\)",
     'pAct("vAddToCartToast", [ci, ii], "click", "stop")'),
    (r"event\.stopPropagation\(\);adjustQty\(' \+ ci \+ ',\' \+ ii \+ ',\\'q\\',(-?1)\)",
     None),  # يُعالَج أدناه (يحتاج الاتجاه)
    (r"event\.stopPropagation\(\);previewInvoice\(' \+ \(invoices\.length - 1 - i\) \+ '\)",
     'pAct("vPreviewInvoice", [(invoices.length - 1 - i)], "click", "stop")'),
    (r"event\.stopPropagation\(\);deleteInvoice\(' \+ \(invoices\.length - 1 - i\) \+ '\)",
     'pAct("vDeleteInvoice", [(invoices.length - 1 - i)], "click", "stop")'),
    (r"accTab=\\'profile\\';renderAccount\(\)", 'pAct("vAccTab", ["profile"])'),
    (r"accTab=\\'orders\\';renderAccount\(\)", 'pAct("vAccTab", ["orders"])'),
    (r"accTab=\\'fav\\';renderAccount\(\)", 'pAct("vAccTab", ["fav"])'),
    (r"closeModal\(\);accTab=\\'orders\\';setView\(\\'account\\'\);renderAccount\(\)", 'pAct("vGoMyOrders", [])'),
    (r"closeModal\(\);setView\(\\'shop\\'\);openCart\(\)", 'pAct("vCloseModalShopCart", [])'),
    (r"closeModal\(\);setView\(\\'shop\\'\)", 'pAct("vCloseModalShop", [])'),
    (r"closeModal\(\);openCart\(\)", 'pAct("vCloseModalCart", [])'),
    (r"closeCart\(\);setView\(\\'shop\\'\)", 'pAct("vCloseCartShop", [])'),
    (r"closeProductDetail\(\);showLegal\(\\'returns\\'\)", 'pAct("vDetailToReturns", [])'),
    (r"setView\(\\'shop\\'\);closeProductDetail\(\)", 'pAct("vShopCloseDetail", [])'),
    (r"setView\(\\'home\\'\);closeProductDetail\(\)", 'pAct("vHomeCloseDetail", [])'),
    (r"shopFavOnly=false;const cb=document\.getElementById\(\\'favOnly\\'\); if\(cb\) cb\.checked=false; renderAll\(\)",
     'pAct("vClearFavFilter", [])'),
    (r"let q=parseInt\(document\.getElementById\(\\'amzQty\\'\)\.value\)\|\|1; for\(let i=0;i<q;i\+\+\) addToCart\('\+ci\+','\+ii\+'\); clo[^\"]*",
     'pAct("vAddQtyToCart", [ci, ii])'),
    (r"closeProductDetail\(\);openModal\(\\'edit\\','\+ci\+','\+ii\+'\)",
     'pAct("vEditProduct", [ci, ii])'),
]

src = open(PATH, encoding='utf-8').read()
handlers = cod.find_handlers(src)
done, unknown = 0, []
for start, end, ev, raw, term in reversed(handlers):
    repl_js = None
    for pattern, replacement in RULES:
        if replacement is None:
            m = re.fullmatch(pattern, raw)
            if m:
                direction = m.group(1)
                repl_js = 'pAct("vAdjustQty", [ci, ii, %s], "click", "stop")' % direction
                break
            continue
        if re.fullmatch(pattern, raw):
            repl_js = replacement
            break
    if repl_js is None:
        unknown.append(raw)
        continue
    src = src[:start] + "' + " + repl_js + " + '" + src[end:]
    done += 1

open(PATH, 'w', encoding='utf-8').write(src)
left = len(re.findall(r'\bon(?:click|input|change|keydown|submit|blur)=', src))
print(f'{PATH}: غُلِّف {done} · متبقٍ {left}')
for u in unknown:
    print('   ⚠️ غير مغطّى:', u[:150])
