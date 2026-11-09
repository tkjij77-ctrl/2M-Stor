"""T7.4/هـ — تحويل معالجات web/ui.js (آخر ملف) إلى data-act.

لماذا سكربت مخصّص بدل pass1 العام: معالجات ui.js ليست نداءات بسيطة، بل
عبارات متعدّدة (stopPropagation + نداء)، وأحداث سحب وإفلات،وشروط على القيمة
(`if(event.key==='Enter')`, `if(this.value.trim())`). النداء العام لا يستطيع
تفكيكها بأمان، والتفكيك الخاطئ عطب صامت — لذلك قواعد صريحة، كل واحدة مكتوبة
بالنصّ الحرفي كما هو في الملف، ثم نُعيد `node --check`.

التشغيل: python3 scripts/codemod-inline-handlers-pass3-ui.py
"""
import sys

P = 'web/ui.js'

DRAG = (
    '\' + pAct("openFilePicker", ["modal-image"]) + \' \' '
    '+ pAct("dragHighlight", [], "dragover", "prevent") + \' \' '
    '+ pAct("dragReset", [], "dragleave") + \' \' '
    '+ pAct("handleDrop", [pAct.EVENT], "drop") + \''
)

RULES = [
    # 0) كتلة السحب والإفلات كاملة (onclick + ondragover + ondragleave + ondrop)
    (
        'onclick="document.getElementById(\\\'modal-image\\\').click()" '
        'ondragover="event.preventDefault(); this.style.borderColor=\\\'var(--primary)\\\'; '
        'this.style.background=\\\'var(--primary-light)\\\'" '
        'ondragleave="this.style.borderColor=\\\'var(--border)\\\'; '
        'this.style.background=\\\'var(--bg-soft)\\\'" ondrop="handleDrop(event)"',
        DRAG,
    ),
    # 1) أحداث متعدّدة العبارات → أغلفة مسمّاة
    ('onclick="event.stopPropagation();document.getElementById(\\\'modal-image\\\').click()"',
     '\' + pAct("openFilePicker", ["modal-image"], "click", "stop") + \''),
    ('onclick="event.stopPropagation();clearImage()"',
     '\' + pAct("clearImage", [], "click", "stop") + \''),
    ('onclick="event.stopPropagation();captureProductPhoto()"',
     '\' + pAct("captureProductPhoto", [], "click", "stop") + \''),
    ('onclick="closeModal();openSettingsModal()"',
     '\' + pAct("closeModalOpenSettings") + \''),
    ('onclick="retryFailedOps();openSyncStatus()"',
     '\' + pAct("retryFailedOpsSync") + \''),
    ('onclick="clearFailedOps();openSyncStatus()"',
     '\' + pAct("clearFailedOpsSync") + \''),
    ('onclick="flushOutbox();setTimeout(openSyncStatus,600)"',
     '\' + pAct("flushOutboxNow") + \''),
    # 2) شروط على المفتاح/القيمة → شروط مُعلَنة (data-key / data-nonempty)
    ('onkeydown="if(event.key===\\\'Enter\\\'){event.preventDefault();loadImageFromUrl(this.value)}"',
     '\' + pAct("loadImageFromUrl", [pAct.VALUE], "keydown", "key=Enter prevent") + \''),
    ('onblur="if(this.value.trim()) loadImageFromUrl(this.value.trim())"',
     '\' + pAct("loadImageFromUrl", [pAct.VALUE], "blur", "nonempty") + \''),
    # 3) اختيار الملفات
    ('onclick="document.getElementById(\\\'scanInput\\\').click()"',
     '\' + pAct("openFilePicker", ["scanInput"]) + \''),
    ('onclick="document.getElementById(\\\'modal-image\\\').click()"',
     '\' + pAct("openFilePicker", ["modal-image"]) + \''),
    # 4) نداءات مفردة
    ('onclick="closeModal()"', '\' + pAct("closeModal") + \''),
    ('onclick="addCategory()"', '\' + pAct("addCategory") + \''),
    ('onclick="startCameraScan()"', '\' + pAct("startCameraScan") + \''),
    ('onclick="saveItem()"', '\' + pAct("saveItem") + \''),
    ('onclick="deleteItem()"', '\' + pAct("deleteItem") + \''),
    ('onclick="saveSettingsForm()"', '\' + pAct("saveSettingsForm") + \''),
    ('onclick="openTrash()"', '\' + pAct("openTrash") + \''),
    ('onclick="openSyncStatus()"', '\' + pAct("openSyncStatus") + \''),
    ('onclick="manualBackup()"', '\' + pAct("manualBackup") + \''),
    ('onclick="closePhotoBox()"', '\' + pAct("closePhotoBox") + \''),
    ('oninput="syncNumericPrice()"', '\' + pAct("syncNumericPrice", [], "input") + \''),
    ('oninput="this.dataset.manual=\\\'1\\\'"', '\' + pAct("markManual", [], "input") + \''),
    ('onchange="handleImageFile(event)"',
     '\' + pAct("handleImageFile", [pAct.EVENT], "change") + \''),
    # 5) حجج مُولَّدة في وقت الرسم
    ('onclick="deleteCategory(\' + ci + \')"',
     '\' + pAct("deleteCategory", [ci]) + \''),
    ('onclick="restoreBackup(\' + i + \')"',
     '\' + pAct("restoreBackup", [i]) + \''),
    ('onclick="restoreCloudTrash(\\\'cat\\\',\' + c.id + \')"',
     '\' + pAct("restoreCloudTrash", ["cat", c.id]) + \''),
    ('onclick="restoreCloudTrash(\\\'item\\\',\' + i.id + \')"',
     '\' + pAct("restoreCloudTrash", ["item", i.id]) + \''),
    ('onclick="restoreLocalTrash(\\\'\' + t.lid + \'\\\')"',
     '\' + pAct("restoreLocalTrash", [t.lid]) + \''),
    ('onclick="purgeLocalTrash(\\\'\' + t.lid + \'\\\')"',
     '\' + pAct("purgeLocalTrash", [t.lid]) + \''),
]

s = open(P, encoding='utf-8').read()
total = 0
for old, new in RULES:
    n = s.count(old)
    if n:
        s = s.replace(old, new)
        total += n
open(P, 'w', encoding='utf-8').write(s)
print(f'حُوِّل {total} موضعًا في {P}')

import re
left = re.findall(r'\bon(?:click|input|change|keydown|blur|submit|drop|dragover|dragleave)=', s)
print('متبقٍ:', len(left))
sys.exit(0)
