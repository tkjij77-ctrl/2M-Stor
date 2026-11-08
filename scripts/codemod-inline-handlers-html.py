import re

p = 'index.html'
s = open(p, encoding='utf-8').read()
orig = s

# تعبير المعالج → سمات data-* (المفتاح: النص كما هو داخل onxxx="")
MAP = {
    # ── تنقّل وعرض ──
    "setView('shop')": 'setView-shop', "setView('home')": 'setView-home',
    "setView('stock')": 'setView-stock', "setView('account')": 'setView-account',
    "openCart()": 'call', "closeCart()": 'call', "toggleDashboard()": 'call',
    "toggleStaffPage()": 'call', "toggleFabMenu()": 'call',
    "openSettingsModal()": 'call', "closeBurger()": 'call',
    "toggleDarkMode()": 'call', "startCameraScan()": 'call',
    "showLogin()": 'call', "hideLogin()": 'call',
    "quickLock()": 'call', "openPassModal()": 'call', "openAlertsModal()": 'call',
    "logoutFromLock()": 'call', "logout()": 'call', "exportData()": 'call',
    "unlockWithPasswordPrompt()": 'call',
    "debouncedRenderAll()": 'call',
    # ── مع وسائط ──
    "showLegal('terms')": 'arg', "showLegal('returns')": 'arg', "showLegal('privacy')": 'arg',
    # ── أغلفة مسمّاة ──
    "toggleFabMenu();openModal('add')": ('act', 'actFabAddItem'),
    "toggleFabMenu();addCategory()": ('act', 'actFabAddCategory'),
    "setView('shop'); shopFavOnly=true; setTimeout(()=>{const cb=document.getElementById('favOnly'); if(cb) cb.checked=true; renderAll(); updateFavBadge();},80)": ('act', 'actFavOnly'),
    "closeBurger();showInvoiceHistory()": ('act', 'actInvoicesFromBurger'),
    "closeBurger();quickLock()": ('act', 'actLockFromBurger'),
    "can('history')&&showInvoiceHistory()": ('act', 'actInvoicesIfAllowed'),
    "window.scrollTo({top:0,behavior:'smooth'})": ('act', 'actScrollTop'),
    "document.getElementById('landing-features').scrollIntoView({behavior:'smooth'})": ('act', 'actScrollToFeatures'),
    "document.getElementById('landing-features')&&document.getElementById('landing-features').scrollIntoView({behavior:'smooth'})": ('act', 'actScrollToFeatures'),
    "document.getElementById('landing-footer').scrollIntoView({behavior:'smooth'})": ('act', 'actScrollToFooter'),
    "document.getElementById('landing-footer')&&document.getElementById('landing-footer').scrollIntoView({behavior:'smooth'})": ('act', 'actScrollToFooter'),
    "document.getElementById('scanInput').click()": ('act', 'actPickScanInput'),
    "document.getElementById('importInput').click()": ('act', 'actPickImportInput'),
    "importData(event)": 'event:importData',
    "if(event.target===this)hideLogin()": ('act', 'actHideLoginIfBackdrop'),
    "if(event.target===this)closeProductDetail()": ('act', 'actCloseDetailIfBackdrop'),
}

unmapped = []
count = 0

def repl(m):
    global count
    ev, code = m.group(1), m.group(2)
    code = code.strip()
    rule = MAP.get(code)
    if rule is None:
        unmapped.append((ev, code))
        return m.group(0)
    if isinstance(rule, tuple):
        name = rule[1]
        attrs = 'data-act="%s"' % name
        if ev != 'click':
            attrs += ' data-on="%s"' % ev
        count += 1
        return attrs
    if rule == 'call':
        name = code.split('(')[0].strip()
        attrs = 'data-act="%s"' % name
        if ev != 'click':
            attrs += ' data-on="%s"' % ev
        count += 1
        return attrs
    if rule.startswith('setView-'):
        attrs = "data-act=\"setView\" data-json='[\"%s\"]'" % rule.split('-', 1)[1]
        count += 1
        return attrs
    if isinstance(rule, str) and rule.startswith('event:'):
        return 'data-act="%s" data-on="%s" data-event' % (rule.split(':', 1)[1], ev)
    if rule == 'event':
        name = code.split('(')[0].strip()
        return 'data-act="%s" data-on="%s" data-event' % (name, ev)
    if rule == 'arg':
        name = code.split('(')[0].strip()
        arg = re.search(r"\((.*)\)", code).group(1).strip()
        arg = arg[1:-1] if arg[:1] in "'\"" else arg
        attrs = "data-act=\"%s\" data-json='[\"%s\"]'" % (name, arg)
        count += 1
        return attrs
    return m.group(0)

# المعالجات الحقيقية فقط (on + حدث) — نتجنّب محتوى/سمات أخرى
s = re.sub(r'\bon(click|input|change|keydown|submit|blur)="([^"]*)"', repl, s)

open(p, 'w', encoding='utf-8').write(s)
left = len(re.findall(r'\bon(?:click|input|change|keydown|submit|blur)=', s))
print('حُوِّل:', count, '· متبقٍ:', left)
if unmapped:
    print('⚠️ غير مغطّى:')
    for ev, code in unmapped:
        print('  ', ev, '::', code[:120])
