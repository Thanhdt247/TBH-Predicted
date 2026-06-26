'use strict';
var PROBE_VERSION = 'v64-force-select-explicit-id-raw-queue-20260624 (English/Fixed)';
send({ type: 'ready', version: PROBE_VERSION });
console.log = function() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    send({ type: 'log', payload: parts.join(' ') });
};
console.error = console.log;
console.warn = console.log;

var GA = Process.enumerateModules().find(function(m) { return m.name.toLowerCase().indexOf('gameassembly') !== -1; });
if (!GA) throw new Error('GameAssembly.dll not found');
var B = GA.base;
console.log('Drop probe ' + PROBE_VERSION);
console.log('GameAssembly.dll @ ' + B);

// Resolve exported IL2CPP APIs by name so game updates do not invalidate RVAs.
function api(name, ret, args) {
    return new NativeFunction(GA.getExportByName(name), ret, args);
}
var dn = api('il2cpp_domain_get', 'pointer', []);
var daf = api('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
var aif = api('il2cpp_assembly_get_image', 'pointer', ['pointer']);
var iccf = api('il2cpp_image_get_class_count', 'int', ['pointer']);
var icf = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
var cfn = api('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']);
var cmfn = api('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']);
var cnf = api('il2cpp_class_get_name', 'pointer', ['pointer']);
var cgffn = api('il2cpp_class_get_field_from_name', 'pointer', ['pointer', 'pointer']);
var fsgv = api('il2cpp_field_static_get_value', 'void', ['pointer', 'pointer']);
var fssv = api('il2cpp_field_static_set_value', 'void', ['pointer', 'pointer']);
var cgf = api('il2cpp_class_get_fields', 'pointer', ['pointer', 'pointer']);
var fgn = api('il2cpp_field_get_name', 'pointer', ['pointer']);
var fgt = api('il2cpp_field_get_type', 'pointer', ['pointer']);
var fgo = api('il2cpp_field_get_offset', 'int', ['pointer']);
var tgn = api('il2cpp_type_get_name', 'pointer', ['pointer']);
var cgm = api('il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']);
var mgn = api('il2cpp_method_get_name', 'pointer', ['pointer']);
var mgpc = api('il2cpp_method_get_param_count', 'int', ['pointer']);
var mgrt = api('il2cpp_method_get_return_type', 'pointer', ['pointer']);
var il2cppStringNew = api('il2cpp_string_new', 'pointer', ['pointer']);
var mgp = null;
try {
    mgp = api('il2cpp_method_get_param', 'pointer', ['pointer', 'int']);
} catch(e) {}
var mgf = null;
try {
    mgf = api('il2cpp_method_get_flags', 'uint32', ['pointer', 'pointer']);
} catch(e) {}
var il2cppThreadAttach = null;
try {
    il2cppThreadAttach = api('il2cpp_thread_attach', 'pointer', ['pointer']);
} catch(e) {}

function cstr(s) { return Memory.allocUtf8String(s); }
function readStr(p) {
    try { return p && !p.isNull() ? p.readCString() : ''; } catch(e) { return ''; }
}
function readIl2cppString(p) {
    try {
        if (!p || p.isNull()) return '';
        var len = p.add(0x10).readS32();
        if (len <= 0 || len > 4096) return '';
        return p.add(0x14).readUtf16String(len);
    } catch(e) {
        return '';
    }
}
function makeIl2cppString(text) {
    return il2cppStringNew(cstr(text));
}
function ensureIl2cppThreadAttached() {
    try {
        if (il2cppThreadAttach) il2cppThreadAttach(dn());
    } catch(e) {}
}
function findMethod(img, ns, klass, method, key) {
    var k = cfn(img, cstr(ns), cstr(klass));
    if (!k || k.isNull()) return false;
    var m = cmfn(k, cstr(method), -1);
    if (!m || m.isNull()) return false;
    var fp = m.readPointer();
    var methodKey = key || (klass + '.' + method);
    found[methodKey] = fp;
    var argc = -1;
    var retName = '';
    try { argc = mgpc(m); } catch(e) {}
    try { retName = readStr(tgn(mgrt(m))); } catch(e) {}
    foundMeta[methodKey] = { argc: argc, retName: retName };
    try { console.log('  ' + (ns ? ns + '.' : '') + klass + '.' + method + '(' + argc + ') -> ' + retName + ' @ RVA=0x' + fp.sub(B).toInt32().toString(16)); } catch(e) {}
    return true;
}
function findFieldOffset(img, ns, klass, field, key) {
    var k = cfn(img, cstr(ns), cstr(klass));
    if (!k || k.isNull()) return false;
    var f = cgffn(k, cstr(field));
    if (!f || f.isNull()) return false;
    try {
        var offset = fgo(f);
        found[key || (klass + '.' + field)] = offset;
        console.log('  ' + (ns ? ns + '.' : '') + klass + '.' + field + ' @ offset=0x' + offset.toString(16));
        return true;
    } catch(e) {}
    return false;
}
function findFieldPointer(img, ns, klass, field, key) {
    var k = cfn(img, cstr(ns), cstr(klass));
    if (!k || k.isNull()) return false;
    var f = cgffn(k, cstr(field));
    if (!f || f.isNull()) return false;
    found[key || (klass + '.' + field + '.field')] = f;
    try { console.log('  ' + (ns ? ns + '.' : '') + klass + '.' + field + ' field @ ' + f); } catch(e) {}
    return true;
}
function logClassMethods(klassPtr, classLabel, limit) {
    try {
        var iter = Memory.alloc(Process.pointerSize);
        iter.writePointer(ptr(0));
        var count = 0;
        console.log('  ' + classLabel + ' methods scan:');
        while (count < limit) {
            var method = cgm(klassPtr, iter);
            if (!method || method.isNull()) break;
            var name = readStr(mgn(method));
            var argc = -1;
            var retName = '';
            var rva = '';
            try { argc = mgpc(method); } catch(e) {}
            try { retName = readStr(tgn(mgrt(method))); } catch(e) {}
            try {
                var fp = method.readPointer();
                if (fp && !fp.isNull()) rva = ' RVA=0x' + fp.sub(B).toInt32().toString(16);
            } catch(e) {}
            console.log('    ' + classLabel + '.' + name + '(' + argc + ') -> ' + retName + rva);
            if (classLabel === 'vw' || classLabel === found['queueClassName']) {
                try {
                    if (!found['vwMethodCandidates']) found['vwMethodCandidates'] = [];
                    var candidateFp = method.readPointer();
                    if (candidateFp && !candidateFp.isNull()) {
                        found['vwMethodCandidates'].push({ name: name, argc: argc, retName: retName, fp: candidateFp });
                    }
                } catch(e) {}
            }
            count++;
        }
        if (count >= limit) console.log('    ... method scan truncated at ' + limit);
    } catch(e) {
        console.log('  ' + classLabel + ' method scan failed: ' + e);
    }
}
function queueClassMatchesTypeName(typeName) {
    if (!typeName) return false;
    if (found['queueClassName'] && typeName === found['queueClassName']) return true;
    return typeName === 'vw' || typeName.indexOf('vw') !== -1;
}

function isQueueDictionaryType(typeName) {
    if (!typeName) return false;
    return typeName.indexOf('Dictionary') !== -1 &&
        typeName.indexOf('TaskbarHero.EBoxType') !== -1 &&
        typeName.indexOf('TaskbarHero.BoxData') !== -1;
}

function collectQueueFieldOffsets(klassPtr, classLabel, verbose) {
    var offsets = [];
    try {
        var iter = Memory.alloc(Process.pointerSize);
        iter.writePointer(ptr(0));
        while (true) {
            var field = cgf(klassPtr, iter);
            if (!field || field.isNull()) break;
            var name = readStr(fgn(field));
            var typeName = readStr(tgn(fgt(field)));
            if (!isQueueDictionaryType(typeName)) continue;
            var offset = fgo(field);
            offsets.push(offset);
            if (verbose) console.log('  ' + classLabel + '.' + name + ' queue field @ offset=0x' + offset.toString(16) + ' type=' + typeName);
        }
    } catch(e) {}
    offsets.sort(function(a, b) { return a - b; });
    return offsets;
}

function registerQueueClass(klassPtr, classLabel, verbose) {
    var offsets = collectQueueFieldOffsets(klassPtr, classLabel, verbose);
    if (offsets.length === 0) return false;
    found['vwClass'] = klassPtr;
    found['queueClassName'] = classLabel;
    found['queueFieldOffsets'] = offsets;
    console.log('  ' + classLabel + ' selected as drop queue class; queue fields=' + offsets.map(function(o) { return '0x' + o.toString(16); }).join(','));
    logClassMethods(klassPtr, classLabel, 180);
    return true;
}

function findQueueClassByFields() {
    for (var a = 0; a < cnt; a++) {
        var asm = asms.add(a * Process.pointerSize).readPointer();
        if (!asm || asm.isNull()) continue;
        var img = aif(asm);
        if (!img || img.isNull()) continue;
        var cc = 0;
        try { cc = iccf(img); } catch(e) { continue; }
        if (cc === 0 || cc > 10000) continue;
        for (var c = 0; c < cc; c++) {
            var k = icf(img, c);
            if (!k || k.isNull()) continue;
            var cn = readStr(cnf(k));
            if (!cn || cn.length > 32) continue;
            var offsets = collectQueueFieldOffsets(k, cn, false);
            if (offsets.length >= 2) {
                found['vwClass'] = k;
                found['queueClassName'] = cn;
                found['queueFieldOffsets'] = offsets;
                console.log('  ' + cn + ' selected as drop queue class by field scan; queue fields=' + offsets.map(function(o) { return '0x' + o.toString(16); }).join(','));
                logClassMethods(k, cn, 180);
                return true;
            }
        }
    }
    console.log('  drop queue class field scan: NOT FOUND');
    return false;
}

function findVwInstanceField(owner) {
    var directNames = ['beyk', 'bskg'];
    for (var i = 0; i < directNames.length; i++) {
        var direct = cgffn(owner, cstr(directNames[i]));
        if (direct && !direct.isNull()) {
            var directType = '';
            try { directType = readStr(tgn(fgt(direct))); } catch(e) {}
            if (found['queueClassName'] && !queueClassMatchesTypeName(directType)) continue;
            found['vwInstanceField'] = direct;
            console.log('  wk.' + directNames[i] + ' selected as drop queue instance field, type=' + directType);
            return true;
        }
    }

    try {
        var iter = Memory.alloc(Process.pointerSize);
        iter.writePointer(ptr(0));
        while (true) {
            var field = cgf(owner, iter);
            if (!field || field.isNull()) break;
            var name = readStr(fgn(field));
            var typeName = readStr(tgn(fgt(field)));
            if (queueClassMatchesTypeName(typeName)) {
                found['vwInstanceField'] = field;
                console.log('  wk.' + name + ' selected as drop queue instance field, type=' + typeName);
                return true;
            }
        }
    } catch(e) {
        console.log('  wk field scan failed: ' + e);
    }

    console.log('  drop queue instance field: NOT FOUND');
    return false;
}

function findQueueInstanceFieldByStaticScan() {
    if (!found['queueClassName']) return false;
    for (var a = 0; a < cnt; a++) {
        var asm = asms.add(a * Process.pointerSize).readPointer();
        if (!asm || asm.isNull()) continue;
        var img = aif(asm);
        if (!img || img.isNull()) continue;
        var cc = 0;
        try { cc = iccf(img); } catch(e) { continue; }
        if (cc === 0 || cc > 10000) continue;
        for (var c = 0; c < cc; c++) {
            var k = icf(img, c);
            if (!k || k.isNull()) continue;
            var ownerName = readStr(cnf(k));
            var iter = Memory.alloc(Process.pointerSize);
            iter.writePointer(ptr(0));
            while (true) {
                var field = null;
                try { field = cgf(k, iter); } catch(e) { field = null; }
                if (!field || field.isNull()) break;
                var name = readStr(fgn(field));
                var typeName = readStr(tgn(fgt(field)));
                if (!queueClassMatchesTypeName(typeName)) continue;
                try {
                    g_vwSlot.writePointer(ptr(0));
                    fsgv(field, g_vwSlot);
                    var instance = g_vwSlot.readPointer();
                    if (instance && !instance.isNull() && setQueueOwnerIfValid(instance, ownerName + '.' + name)) {
                        found['vwInstanceField'] = field;
                        console.log('  ' + ownerName + '.' + name + ' selected as drop queue static field, type=' + typeName);
                        return true;
                    }
                } catch(e) {}
            }
        }
    }
    console.log('  drop queue static field scan: NOT FOUND');
    return false;
}

// Find all target methods
var d = dn();
var sz = Memory.alloc(4);
var asms = daf(d, sz);
var cnt = sz.readU32();

var emptyNs = cstr('');
var found = {};
var foundMeta = {};

var g_vw = null;
var g_vwSlot = Memory.alloc(Process.pointerSize);
var g_lastGoodQueueOwner = null;

for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    if (findFieldOffset(img, 'TaskbarHero', 'BoxData', 'itemId', 'BoxData.itemId')) {
        findFieldOffset(img, 'TaskbarHero', 'BoxData', 'rewardItemId', 'BoxData.rewardItemId');
        findFieldOffset(img, 'TaskbarHero', 'BoxData', 'o_itemId', 'BoxData.o_itemId');
        findFieldOffset(img, 'TaskbarHero', 'BoxData', 'o_rewardItemId', 'BoxData.o_rewardItemId');
        break;
    }
}
if (typeof found['BoxData.itemId'] !== 'number') console.log('  TaskbarHero.BoxData.itemId: NOT FOUND; fallback offset=0x3c');
if (typeof found['BoxData.rewardItemId'] !== 'number') console.log('  TaskbarHero.BoxData.rewardItemId: NOT FOUND; fallback offset=0x68');
for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    if (findFieldOffset(img, 'CodeStage.AntiCheat.ObscuredTypes', 'ObscuredInt', 'hiddenValue', 'ObscuredInt.hiddenValue')) {
        findFieldOffset(img, 'CodeStage.AntiCheat.ObscuredTypes', 'ObscuredInt', 'currentCryptoKey', 'ObscuredInt.currentCryptoKey');
        break;
    }
}
if (typeof found['ObscuredInt.hiddenValue'] !== 'number' || typeof found['ObscuredInt.currentCryptoKey'] !== 'number') {
    console.log('  CodeStage.AntiCheat.ObscuredTypes.ObscuredInt decrypt fields: NOT FOUND; encrypted reward fallback disabled');
}

// Search for DECRYPT function
var g_decryptFn = null;
console.log('Searching for DECRYPT function (op_Implicit)...');
for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    
    var oi = cfn(img, cstr('CodeStage.AntiCheat.ObscuredTypes'), cstr('ObscuredInt'));
    if (oi && !oi.isNull()) {
        var iter = Memory.alloc(Process.pointerSize);
        iter.writePointer(ptr(0));
        var method;
        while (true) {
            method = cgm(oi, iter);
            if (!method || method.isNull()) break;
            var mName = readStr(mgn(method));
            if (mName === 'op_Implicit') {
                var retName = readStr(tgn(mgrt(method)));
                if (retName === 'System.Int32' || retName === 'int' || retName === 'Int32') {
                    var fp = method.readPointer();
                    if (fp && !fp.isNull()) {
                        g_decryptFn = new NativeFunction(fp, 'int', ['pointer']);
                        console.log('  ✓ Found DECRYPT @ RVA=0x' + fp.sub(B).toInt32().toString(16));
                        break;
                    }
                }
            }
        }
        break;
    }
}

// Known class names: vw has jsq/jsl/jso, other class has iqg/iql
// First find vw methods
for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    
    var k = cfn(img, emptyNs, cstr('vw'));
    if (!k || k.isNull()) continue;
    found['vwClass'] = k;
    found['queueClassName'] = 'vw';
    registerQueueClass(k, 'vw', true);
    
    var targets = ['jsq', 'jsl', 'jso', 'jsp', 'efk', 'el', 'gmz', 'nvm', 'idd', 'jsm', 'llp', 'jtg'];
    for (var ti = 0; ti < targets.length; ti++) {
        var m = cmfn(k, cstr(targets[ti]), -1);
        if (m && !m.isNull()) {
            var fp = m.readPointer();
            var rva = fp.sub(B).toInt32();
            found[targets[ti]] = fp;
            console.log('  vw.' + targets[ti] + ' @ RVA=0x' + rva.toString(16));
        }
    }
    break; 
}

if (!found['vwClass']) {
    console.log('  vw class not found; scanning drop queue class by fields...');
    findQueueClassByFields();
}

for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    var owner = cfn(img, emptyNs, cstr('wk'));
    if (owner && !owner.isNull()) {
        if (findVwInstanceField(owner)) break;
    }
}
if (!found['vwInstanceField']) {
    findQueueInstanceFieldByStaticScan();
}

// Stage/UI hooks
for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;

    findMethod(img, 'TaskbarHero', 'UI_Stage', 'huq', 'UI_Stage.huq');
    findMethod(img, 'TaskbarHero', 'UI_Stage', 'hva', 'UI_Stage.hva');
    findMethod(img, 'TaskbarHero', 'UI_Stage', 'hvc', 'UI_Stage.hvc');
    findMethod(img, 'TaskbarHero', 'StageManager', 'ign', 'StageManager.ign');
    findMethod(img, 'TaskbarHero', 'StageManager', 'ifo', 'StageManager.ifo');
    findMethod(img, 'TaskbarHero', 'StageManager', 'ifn', 'StageManager.ifn');
    findMethod(img, 'TaskbarHero', 'StageManager', 'igc', 'StageManager.igc');
    findMethod(img, 'TaskbarHero', 'StageManager', 'igs', 'StageManager.igs');
    findMethod(img, 'TaskbarHero', 'StageManager', 'igx', 'StageManager.igx');
    findMethod(img, 'TaskbarHero', 'StageManager', 'igy', 'StageManager.igy');
    findMethod(img, 'TaskbarHero', 'StageManager', 'ihr', 'StageManager.ihr');
    findMethod(img, 'TaskbarHero', 'StageBoxRequestAbuseGuard', 'hfk', 'StageBoxRequestAbuseGuard.hfk');
    findMethod(img, 'TaskbarHero', 'StageBoxRequestAbuseGuard', 'hfl', 'StageBoxRequestAbuseGuard.hfl');
    findMethod(img, 'TaskbarHero', 'StageBoxRequestAbuseGuard', 'hfm', 'StageBoxRequestAbuseGuard.hfm');
    findMethod(img, 'TaskbarHero', 'StageNode', 'hrc', 'StageNode.hrc');
    findMethod(img, 'TaskbarHero', 'StageNode', 'hrd', 'StageNode.hrd');
    findMethod(img, 'TaskbarHero', 'StageNode', 'hre', 'StageNode.hre');
    findMethod(img, 'TaskbarHero', 'StageNode', 'hrf', 'StageNode.hrf');
    findFieldOffset(img, 'TaskbarHero', 'StageNode', 'bdbh', 'StageNode.bdbh');
    findFieldOffset(img, 'TaskbarHero', 'StageNode', 'bdcv', 'StageNode.bdcv');
    findFieldOffset(img, 'TaskbarHero', 'StageNode', 'button_Enter', 'StageNode.button_Enter');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqf', 'UI_Portal.lqf');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqi', 'UI_Portal.lqi');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqj', 'UI_Portal.lqj');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqk', 'UI_Portal.lqk');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqe', 'UI_Portal.lqe');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lql', 'UI_Portal.lql');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqt', 'UI_Portal.lqt');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqw', 'UI_Portal.lqw');
    findMethod(img, 'TaskbarHero.UI', 'UI_Portal', 'lqx', 'UI_Portal.lqx');
    findFieldOffset(img, 'TaskbarHero.UI', 'UI_Portal', 'm_abuseGuardPopup', 'UI_Portal.m_abuseGuardPopup');
    findFieldOffset(img, 'TaskbarHero.UI', 'UI_Portal', 'm_abuseGuardRemainText', 'UI_Portal.m_abuseGuardRemainText');
    findFieldOffset(img, 'TaskbarHero.UI', 'UI_Portal', 'm_currentStageDifficulty', 'UI_Portal.m_currentStageDifficulty');
    findFieldOffset(img, 'TaskbarHero.UI', 'UI_Portal', 'bfzh', 'UI_Portal.bfzh');
    findFieldOffset(img, 'TaskbarHero.UI', 'UI_Portal', 'bfzi', 'UI_Portal.bfzi');
    findFieldPointer(img, 'TaskbarHero.UI', 'UI_Portal', 'bfxe', 'UI_Portal.bfxe.field');
    findFieldPointer(img, 'TaskbarHero.UI', 'UI_Portal', 'bfxf', 'UI_Portal.bfxf.field');
    findMethod(img, 'UnityEngine.UI', 'Button', 'Press', 'UnityEngine.UI.Button.Press');
    findFieldOffset(img, 'UnityEngine.UI', 'Button', 'm_OnClick', 'UnityEngine.UI.Button.m_OnClick');
    findMethod(img, 'UnityEngine.Events', 'UnityEvent', 'Invoke', 'UnityEngine.Events.UnityEvent.Invoke');
    findFieldOffset(img, '', 'StageCache', 'betl', 'StageCache.betl');
    findFieldOffset(img, 'TaskbarHero.Data', 'StageInfoData', 'StageKey', 'StageInfoData.StageKey');
    findFieldOffset(img, 'TaskbarHero.Data', 'StageInfoData', 'STAGEDIFFICULTY', 'StageInfoData.STAGEDIFFICULTY');
    findFieldOffset(img, 'TaskbarHero.Data', 'StageInfoData', 'Act', 'StageInfoData.Act');
    findFieldOffset(img, 'TaskbarHero.Data', 'StageInfoData', 'StageNo', 'StageInfoData.StageNo');
    findFieldOffset(img, 'TaskbarHero.Data', 'StageInfoData', 'StageLevel', 'StageInfoData.StageLevel');
    findMethod(img, 'UnityEngine', 'GameObject', 'SetActive', 'UnityEngine.GameObject.SetActive');
    findMethod(img, 'TMPro', 'TMP_Text', 'set_text', 'TMPro.TMP_Text.set_text');
    findMethod(img, 'TMPro', 'TextMeshProUGUI', 'set_text', 'TMPro.TextMeshProUGUI.set_text');
    findMethod(img, 'TaskbarHero.UI', 'StageBox', 'lgy', 'StageBox.lgy');
    findMethod(img, 'TaskbarHero.UI', 'StageBox', 'lhb', 'StageBox.lhb');
}

// Now find iqg/iql by searching all classes
console.log('Searching for iqg/iql class...');
for (var a = 0; a < cnt; a++) {
    var asm = asms.add(a * Process.pointerSize).readPointer();
    if (!asm || asm.isNull()) continue;
    var img = aif(asm);
    if (!img || img.isNull()) continue;
    
    var cc = iccf(img);
    if (cc === 0 || cc > 10000) continue;
    
    for (var c = 0; c < cc; c++) {
        var k = icf(img, c);
        if (!k || k.isNull()) continue;
        var cn = cnf(k).readCString();
        if (!cn || cn.length > 6) continue;
        
        if (!found['iqg']) {
            var m = cmfn(k, cstr('iqg'), -1);
            if (m && !m.isNull()) {
                found['iqg'] = m.readPointer();
                console.log('  class "' + cn + '".iqg @ RVA=0x' + found['iqg'].sub(B).toInt32().toString(16));
                if (found['iql']) break;
            }
        }
        if (!found['iql']) {
            var m = cmfn(k, cstr('iql'), -1);
            if (m && !m.isNull()) {
                found['iql'] = m.readPointer();
                console.log('  class "' + cn + '".iql @ RVA=0x' + found['iql'].sub(B).toInt32().toString(16));
                if (found['iqg']) break;
            }
        }
    }
    if (found['iqg'] && found['iql']) break;
}

if (!found['iqg']) console.log('  iqg: NOT FOUND');
if (!found['iql']) console.log('  iql: NOT FOUND');

// ======== Hook setup ========
if (!found['jsq']) {
    console.log('WARN: vw.jsq not found; continuing with queue polling/stage hooks. Send the vw method scan log to map the new drop-select method.');
}

var g_dropCount = 0;
var g_boxOpenCount = 0;
var g_firstJsqSeen = false;
var g_queuesDisplayed = false;
var g_snapshots = new Map();
var g_stageEventCount = 0;
var g_lastStageSignalAt = 0;
var g_pollTick = 0;
var g_forcedSelections = {};
var g_pendingForcedReward = null;
var g_lastFallbackSelectedAt = 0;
var g_lastFallbackSelectedPtr = '';
var g_stageBypassLogAt = {};
var g_lastSafeManualLogAt = 0;
var g_lastUIPortal = null;
var g_lastUIPortalKey = '';
var g_lastStageManager = null;
var g_autoStageNativeFns = {};
var g_seenStageIds = {};
var g_lastStageSeenKey = '';
var g_lastStageSeenAt = 0;
var g_stageManagerArgOrder = '';
var g_portalArgOrder = '';
var g_stageProbeHooked = {};
var g_uiPortalInstanceHooked = {};
var g_stageProbeLastAt = {};
var g_stageProbeCount = 0;
var g_stageLevelKeyMap = {};
var g_stageKeyInfoMap = {};
var g_stageInfoLogKeys = {};
var g_lastPortalDifficulty = 0;
var g_lastCurrentDifficulty = -1;
var g_lastCurrentLevel = 0;
var g_pendingAutoStageSwitch = null;
var g_pendingAutoStageSwitchAt = 0;
var g_pendingStageSwitchConfirm = null;
var g_lastConfirmedStageRefreshKey = '';
var g_lastConfirmedStageRefreshAt = 0;
var g_stageQueueResetPtr = '';
var g_stageQueueResetUntil = 0;
var g_autoStageSwitchExecuting = false;
var g_autoStagePortalMethods = {
    difficultyStage: [],
    stageOnlyVoid: [],
    stageOnlyBool: []
};

// ===============================================
var BYPASS_STAGE_SWITCH_LIMIT = false;
var AUTO_IMPORTANT_COIN_HEAD = false;
var AUTO_ARCANA_TOP5 = false;
// ===============================================

var BYPASS_STAGE_SWITCH_REMAIN_TEXT_CLAMP = false;
var LOG_STAGE_BYPASS_EVENTS = false;
var SEND_STAGE_PROBE_EVENTS = false;
var SEND_UNRECOGNIZED_STAGE_PROBES = false;
var AUTO_STAGE_MAX_ID = 200;
var NOISY_STAGE_PROBE_METHODS = {
    'StageManager.ihf': true,
    'StageManager.ihg': true,
    'StageManager.ihr': true
};
var AUTO_ARCANA_TOP_N = 5;
var FORCE_REWARD_ID_ONLY_IMPORTANT_COINS = true;
var MANUAL_NON_COIN_SOFT_QUEUE = false;
var MANUAL_NON_COIN_SOFT_STEP_SLOTS = 1;
var MANUAL_NON_COIN_SOFT_MIN_INTERVAL_MS = 650;
var IMPORTANT_COIN_IDS = {
    '160001': true, '160002': true, '160003': true, '160004': true, '160005': true,
    '160006': true, '160007': true, '160008': true, '160009': true, '160010': true
};
var ARCANA_MATERIAL_IDS = {
    '115001': true, '115002': true, '115003': true, '115004': true,
    '125001': true, '125002': true, '125003': true, '125004': true,
    '135001': true,
    '145001': true, '145002': true,
    '150006': true,
    '190002': true
};
var g_lastAutoArcanaLogAt = 0;
var g_getTickCount64 = null;
var g_nowWallBase = 0;
var g_nowMonoBase = 0;
var g_nowLastWall = 0;
var g_nowLastMono = 0;

try {
    var kernel32 = Process.getModuleByName('kernel32.dll');
    g_getTickCount64 = new NativeFunction(kernel32.getExportByName('GetTickCount64'), 'uint64', []);
} catch(e) {
    g_getTickCount64 = null;
}

function refreshVwInstance() {
    if (!found['vwInstanceField']) return false;
    try {
        g_vwSlot.writePointer(ptr(0));
        fsgv(found['vwInstanceField'], g_vwSlot);
        var instance = g_vwSlot.readPointer();
        if (instance && !instance.isNull()) {
            return setQueueOwnerIfValid(instance, 'static');
        }
    } catch (e) {}
    return false;
}

function nowMs() {
    try {
        if (g_getTickCount64) {
            var tick = g_getTickCount64();
            var value = parseInt(String(tick), 10);
            if (value > 0) return value;
        }
    } catch(e) {}

    var wall = Date.now();
    if (!g_nowWallBase) {
        g_nowWallBase = wall;
        g_nowMonoBase = wall;
        g_nowLastWall = wall;
        g_nowLastMono = wall;
        return wall;
    }

    if (g_nowLastWall && (wall < g_nowLastWall || wall - g_nowLastWall > 60000)) {
        g_nowWallBase = wall;
        g_nowMonoBase = g_nowLastMono || wall;
    }
    g_nowLastWall = wall;

    var value = g_nowMonoBase + Math.max(0, wall - g_nowWallBase);
    if (value <= g_nowLastMono) value = g_nowLastMono + 1;
    g_nowLastMono = value;
    return value;
}

function now() { var d = new Date(); return '[' + d.toISOString().slice(11, 23) + ']'; }
function log(msg) { console.log(now() + ' ' + msg); }

function labelForEboxType(ebt) {
    return ebt === 0 ? 'Normal Drop' : ebt === 1 ? 'Boss Drop' : ebt === 2 ? 'ACT Drop' : ebt === 3 ? 'Act Boss Drop' : 'Unknown Drop(' + ebt + ')';
}

function metadataOffset(key, fallback) {
    var offset = found[key];
    return (typeof offset === 'number' && offset >= 0) ? offset : fallback;
}

function boxDataItemIdOffset() {
    return metadataOffset('BoxData.itemId', 0x3C);
}

function boxDataRewardItemIdOffset() {
    return metadataOffset('BoxData.rewardItemId', 0x68);
}

function readBoxDataPlainItemId(boxPtr) {
    return boxPtr.add(boxDataItemIdOffset()).readS32();
}

function readBoxDataObscuredInt(boxPtr, key) {
    try {
        var valueOffset = found[key];
        var hiddenOffset = found['ObscuredInt.hiddenValue'];
        var keyOffset = found['ObscuredInt.currentCryptoKey'];
        if (typeof valueOffset !== 'number' || valueOffset < 0 || typeof hiddenOffset !== 'number' || typeof keyOffset !== 'number') return 0;
        var boxedHeader = 0x10;
        var hiddenValue = boxPtr.add(valueOffset + hiddenOffset - boxedHeader).readS32();
        var currentCryptoKey = boxPtr.add(valueOffset + keyOffset - boxedHeader).readS32();
        return (hiddenValue ^ currentCryptoKey) | 0;
    } catch(e) {
        return 0;
    }
}

function readBoxDataItemId(boxPtr) {
    if (!boxPtr || boxPtr.isNull()) return 0;
    
    var offReward = found['BoxData.o_rewardItemId'];
    if (typeof offReward === 'number') {
        var ptrObj = boxPtr.add(offReward);
        
        if (g_decryptFn) {
            try {
                var val = g_decryptFn(ptrObj);
                if (val > 0 && val < 10000000) return val;
            } catch(e) {}
        }

        try {
            var key = ptrObj.add(0).readS32();
            var hidden = ptrObj.add(4).readS32();
            var valXor = key ^ hidden;
            if (valXor > 0 && valXor < 10000000) return valXor;
        } catch(e) {}
    }

    var rewardItemId = readBoxDataObscuredInt(boxPtr, 'BoxData.o_rewardItemId');
    if (isPlausibleItemId(rewardItemId)) return rewardItemId;
    
    try {
        rewardItemId = readBoxDataRewardItemId(boxPtr);
        if (isPlausibleItemId(rewardItemId)) return rewardItemId;
    } catch(e) {}
    
    var itemId = readBoxDataObscuredInt(boxPtr, 'BoxData.o_itemId');
    if (isPlausibleItemId(itemId)) {
        if (itemId < 900000 || itemId > 999999) return itemId;
    }
    
    var plainId = readBoxDataPlainItemId(boxPtr);
    if (isPlausibleItemId(plainId)) {
        if (plainId < 900000 || plainId > 999999) return plainId;
    }
    
    return 0; 
}

function readBoxDataRewardItemId(boxPtr) {
    return boxPtr.add(boxDataRewardItemIdOffset()).readS32();
}

function writeBoxDataRewardItemId(boxPtr, itemId) {
    boxPtr.add(boxDataRewardItemIdOffset()).writeS32(itemId);
}

function hasActiveForcedSelections() {
    for (var key in g_forcedSelections) {
        if (Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) return true;
    }
    return false;
}

function queueSnapshotKey(q) {
    return 'bexl:' + q.eboxType;
}

function queueStorageKey(q) {
    return 'bexl:' + q.eboxType + ':' + q.sourceIndex + ':' + q.entryIndex;
}

function readQueueDictionaryEntries(dictPtr, sourceLabel, sourceIndex) {
    var results = [];
    if (!dictPtr || dictPtr.isNull()) return results;
    try {
        var ep = dictPtr.add(0x18).readPointer();
        var count = dictPtr.add(0x20).readS32();
        if (!ep || ep.isNull() || count <= 0 || count > 256) return results;
        for (var i = 0; i < count; i++) {
            try {
                var entry = ep.add(0x20 + i * 24);
                var ebt = entry.add(0x08).readS32();
                if (ebt < 0 || ebt > 32) continue;
                var lp = entry.add(0x10).readPointer();
                if (!lp || lp.isNull()) continue;
                var arr = lp.add(0x10).readPointer();
                var sz = lp.add(0x18).readS32();
                if (!arr || arr.isNull() || sz <= 0 || sz > 4096) continue;
                var ids = [];
                var ptrs = [];
                var slotIndices = [];
                for (var j = 0; j < Math.min(sz, 64); j++) {
                    var bd = arr.add(0x20 + j * Process.pointerSize).readPointer();
                    if (bd && !bd.isNull()) {
                        ids.push(readBoxDataItemId(bd));
                        ptrs.push(bd);
                        slotIndices.push(j);
                    }
                }
                if (ids.length === 0) continue;
                results.push({
                    eboxType: ebt,
                    label: labelForEboxType(ebt),
                    items: ids,
                    itemPtrs: ptrs,
                    slotIndices: slotIndices,
                    size: sz,
                    listPtr: lp,
                    arrPtr: arr,
                    source: sourceLabel,
                    sourceIndex: sourceIndex,
                    entryIndex: i
                });
            } catch(inner) {}
        }
    } catch(e) {}
    return results;
}

function readBexlQueueEntriesFrom(ownerPtr) {
    if (!ownerPtr || ownerPtr.isNull()) return [];
    try {
        var results = [];
        var offsets = found['queueFieldOffsets'] || [0x10, 0x10 + Process.pointerSize, 0x10 + 2 * Process.pointerSize];
        for (var di = 0; di < offsets.length; di++) {
            var bexl = ownerPtr.add(offsets[di]).readPointer();
            var fieldEntries = readQueueDictionaryEntries(bexl, (found['queueClassName'] || 'vw') + '.field#' + di, di);
            for (var fi = 0; fi < fieldEntries.length; fi++) {
                results.push(fieldEntries[fi]);
            }
        }
        return results.sort(function(a,b) {
            if (a.eboxType !== b.eboxType) return a.eboxType - b.eboxType;
            if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
            return a.entryIndex - b.entryIndex;
        });
    } catch(e) { return []; }
}

function readBexlQueueEntries() {
    var entries = readBexlQueueEntriesFrom(g_vw);
    if (entries.length > 0) {
        g_lastGoodQueueOwner = g_vw;
        return entries;
    }
    if (g_lastGoodQueueOwner && !g_lastGoodQueueOwner.isNull()) {
        entries = readBexlQueueEntriesFrom(g_lastGoodQueueOwner);
        if (entries.length > 0) {
            g_vw = g_lastGoodQueueOwner;
            return entries;
        }
    }
    return [];
}

function setQueueOwnerIfValid(ownerPtr, source) {
    if (!ownerPtr || ownerPtr.isNull()) return false;
    if (source === 'static' && g_stageQueueResetPtr && ptrKey(ownerPtr) === g_stageQueueResetPtr && nowMs() < g_stageQueueResetUntil) {
        return false;
    }
    var entries = readBexlQueueEntriesFrom(ownerPtr);
    if (entries.length === 0) return false;
    g_vw = ownerPtr;
    g_lastGoodQueueOwner = ownerPtr;
    return true;
}

function compactBexlQueues(entries) {
    var best = {};
    var counts = {};
    for (var i = 0; i < entries.length; i++) {
        var q = entries[i];
        var key = String(q.eboxType);
        counts[key] = (counts[key] || 0) + 1;
        if (!best[key] || q.items.length > best[key].items.length) {
            best[key] = q;
        }
    }

    var results = [];
    for (var key in best) {
        if (!Object.prototype.hasOwnProperty.call(best, key)) continue;
        var selected = best[key];
        selected.copyCount = counts[key] || 1;
        results.push(selected);
    }
    return results.sort(function(a,b) { return a.eboxType - b.eboxType; });
}

function readBexlQueues() {
    return compactBexlQueues(readBexlQueueEntries());
}

function displayQueue(q) {
    log('  [' + q.label + ']  ' + q.items.length + ' items' + (q.items.length > 0 ? '  item[0]=' + q.items[0] : ''));
    var line = q.items.join(',');
    if (line.length <= 90) { log('    items=[' + line + ']'); }
    else { var half = Math.ceil(q.items.length / 2); log('    items=[' + q.items.slice(0, half).join(',')); log('           ' + q.items.slice(half).join(',') + ']'); }
    if (q.items.length > 0) log('    >> Next: ' + q.items[0] + ' <<');
}

function emitQueues(source, queues) {
    try {
        send({
            type: 'queues',
            source: source,
            note: 'Original game memory queue order, index 1 is the next hit',
            queues: queues.map(function(q) {
                return {
                    eboxType: q.eboxType,
                    label: q.label,
                    size: q.size,
                    items: q.items.slice()
                };
            })
        });
    } catch(e) {
        log('emitQueues failed: ' + e);
    }
}

function matchSelectedItem(ret, itemId, queuesOverride) {
    var matches = [];
    var heads = [];
    try {
        var queues = queuesOverride || readBexlQueueEntries();
        for (var qi = 0; qi < queues.length; qi++) {
            var q = queues[qi];
            if (q.items.length > 0) {
                heads.push({ eboxType: q.eboxType, label: q.label, itemId: q.items[0], sourceIndex: q.sourceIndex, entryIndex: q.entryIndex });
            }
            for (var j = 0; j < q.items.length; j++) {
                var pointerMatch = false;
                try {
                    pointerMatch = !!(q.itemPtrs && q.itemPtrs[j] && q.itemPtrs[j].equals(ret));
                } catch(e) {}
                if (pointerMatch || q.items[j] === itemId) {
                    matches.push({
                        eboxType: q.eboxType,
                        label: q.label,
                        index: j + 1,
                        itemId: q.items[j],
                        pointerMatch: pointerMatch,
                        headItemId: q.items.length > 0 ? q.items[0] : 0,
                        sourceIndex: q.sourceIndex,
                        entryIndex: q.entryIndex
                    });
                }
            }
        }
    } catch(e) {}
    return { matches: matches, heads: heads };
}

function describeMatchesForLog(matches) {
    if (!matches || matches.length === 0) return 'Not found in the current panel queue';
    var parts = [];
    for (var i = 0; i < Math.min(matches.length, 6); i++) {
        var m = matches[i];
        parts.push(m.label + '#' + m.index + (m.pointerMatch ? '/ptr' : '/id'));
    }
    if (matches.length > 6) parts.push('...');
    return parts.join(', ');
}

function findItemIndex(q, itemId) {
    for (var i = 0; i < q.items.length; i++) {
        if (q.items[i] === itemId) return i;
    }
    return -1;
}

function findPointerIndex(q, itemPtr) {
    if (!itemPtr) return -1;
    try {
        if (itemPtr.isNull && itemPtr.isNull()) return -1;
    } catch(e) {}
    if (!q.itemPtrs) return -1;
    for (var i = 0; i < q.itemPtrs.length; i++) {
        try {
            if (q.itemPtrs[i] && q.itemPtrs[i].equals(itemPtr)) return i;
        } catch(e) {}
    }
    return -1;
}

function hasForcedSelectionForEboxType(eboxType) {
    return Object.prototype.hasOwnProperty.call(g_forcedSelections, String(eboxType));
}

function isArcanaGearItemId(itemId) {
    itemId = parseInt(itemId || '0', 10);
    if (itemId < 300000 || itemId >= 700000) return false;
    return (Math.floor(itemId / 1000) % 10) === 5;
}

function isArcanaMaterialItemId(itemId) {
    return Object.prototype.hasOwnProperty.call(ARCANA_MATERIAL_IDS, String(itemId));
}

function isArcanaGearOrMaterialItemId(itemId) {
    return isArcanaGearItemId(itemId) || isArcanaMaterialItemId(itemId);
}

function isImportantCoinItemId(itemId) {
    return Object.prototype.hasOwnProperty.call(IMPORTANT_COIN_IDS, String(itemId));
}

function shouldUseAggressiveRewardFix(itemId) {
    if (!FORCE_REWARD_ID_ONLY_IMPORTANT_COINS) return true;
    return isImportantCoinItemId(itemId);
}

function shouldUseSoftManualQueueMode(itemId) {
    itemId = parseInt(itemId || '0', 10);
    return MANUAL_NON_COIN_SOFT_QUEUE && itemId > 0 && !shouldUseAggressiveRewardFix(itemId);
}

function shouldAllowSoftManualMove(reason) {
    var text = String(reason || '');
    if (text.indexOf('Before award') >= 0) return false;
    if (text.indexOf('Before drop') >= 0) return false;
    if (text.indexOf('Map/Update') >= 0) return false;
    if (text.indexOf('auto:') === 0) return false;
    return true;
}

function queueSlotIndex(q, logicalIndex) {
    if (q && q.slotIndices && typeof q.slotIndices[logicalIndex] === 'number') return q.slotIndices[logicalIndex];
    return logicalIndex;
}

function swapQueueSlots(q, leftIndex, rightIndex) {
    if (!q || !q.arrPtr || q.arrPtr.isNull()) return { ok: false, reason: 'Queue array pointer is null' };
    if (leftIndex < 0 || leftIndex >= q.items.length) return { ok: false, reason: 'Left index out of bounds' };
    if (rightIndex < 0 || rightIndex >= q.items.length) return { ok: false, reason: 'Right index out of bounds' };
    if (leftIndex === rightIndex) return { ok: true, changed: false, itemId: q.items[leftIndex] };

    var slotLeft = q.arrPtr.add(0x20 + queueSlotIndex(q, leftIndex) * Process.pointerSize);
    var slotRight = q.arrPtr.add(0x20 + queueSlotIndex(q, rightIndex) * Process.pointerSize);
    var ptrLeft = slotLeft.readPointer();
    var ptrRight = slotRight.readPointer();
    if (!ptrLeft || ptrLeft.isNull()) return { ok: false, reason: 'Left pointer is null' };
    if (!ptrRight || ptrRight.isNull()) return { ok: false, reason: 'Target pointer is null' };

    slotLeft.writePointer(ptrRight);
    slotRight.writePointer(ptrLeft);

    var tmpItem = q.items[leftIndex];
    q.items[leftIndex] = q.items[rightIndex];
    q.items[rightIndex] = tmpItem;
    if (q.itemPtrs) {
        var tmpPtr = q.itemPtrs[leftIndex];
        q.itemPtrs[leftIndex] = q.itemPtrs[rightIndex];
        q.itemPtrs[rightIndex] = tmpPtr;
    }
    return { ok: true, changed: true, itemId: q.items[leftIndex] };
}

function swapQueueHead(q, targetIndex) {
    return swapQueueSlots(q, 0, targetIndex);
}

function promoteImportantCoinHeadInQueue(q) {
    var result = { changed: 0, already: 0, skipped: 0, itemId: 0, promoted: [] };
    if (!AUTO_IMPORTANT_COIN_HEAD || !q || !q.items || q.items.length === 0) return result;
    if (hasForcedSelectionForEboxType(q.eboxType)) return result;

    var writeIndex = 0;
    for (var i = 0; i < q.items.length; i++) {
        if (!isImportantCoinItemId(q.items[i])) continue;
        var swapped = swapQueueSlots(q, writeIndex, i);
        if (!swapped.ok) {
            result.skipped++;
            return result;
        }
        if (swapped.changed) result.changed++;
        else result.already++;
        result.itemId = q.items[0];
        result.promoted.push(q.items[writeIndex]);
        writeIndex++;
    }
    return result;
}

function promoteArcanaTop5InQueue(q) {
    var result = { changed: 0, already: 0, skipped: 0, promoted: [] };
    if ((!AUTO_IMPORTANT_COIN_HEAD && !AUTO_ARCANA_TOP5) || !q || !q.items || q.items.length === 0) return result;

    var coinResult = promoteImportantCoinHeadInQueue(q);
    result.changed += coinResult.changed;
    result.already += coinResult.already;
    result.skipped += coinResult.skipped;
    if (coinResult.promoted && coinResult.promoted.length) {
        for (var ci = 0; ci < coinResult.promoted.length; ci++) result.promoted.push(coinResult.promoted[ci]);
    } else if (coinResult.itemId > 0) {
        result.promoted.push(coinResult.itemId);
    }

    if (!AUTO_ARCANA_TOP5) return result;

    var startIndex = (hasForcedSelectionForEboxType(q.eboxType) || isImportantCoinItemId(q.items[0])) ? 1 : 0;
    var limit = Math.min(AUTO_ARCANA_TOP_N, q.items.length);
    if (startIndex >= limit) return result;

    var writeIndex = startIndex;
    for (var scanIndex = startIndex; scanIndex < q.items.length && writeIndex < limit; scanIndex++) {
        if (!isArcanaGearOrMaterialItemId(q.items[scanIndex])) continue;

        if (scanIndex !== writeIndex) {
            var swapped = swapQueueSlots(q, writeIndex, scanIndex);
            if (!swapped.ok) {
                result.skipped++;
                continue;
            }
            result.changed++;
        } else {
            result.already++;
        }
        result.promoted.push(q.items[writeIndex]);
        writeIndex++;
    }
    return result;
}

function promoteArcanaTop5(reason, verbose) {
    if (!AUTO_IMPORTANT_COIN_HEAD && !AUTO_ARCANA_TOP5) return false;

    var entries = readBexlQueueEntries();
    if (entries.length === 0) return false;

    var changed = false;
    var touched = 0;
    var details = [];
    for (var i = 0; i < entries.length; i++) {
        var q = entries[i];
        var result = promoteArcanaTop5InQueue(q);
        if (result.changed <= 0) continue;

        changed = true;
        touched++;
        if (details.length < 4) details.push(q.label + '=' + result.promoted.join('/'));
    }

    if (changed) {
        g_snapshots.clear();
        g_queuesDisplayed = false;
        var currentMs = nowMs();
        if (verbose || currentMs - g_lastAutoArcanaLogAt > 3000) {
            g_lastAutoArcanaLogAt = currentMs;
            var label = AUTO_ARCANA_TOP5 ? 'Important Coin front / Arcana top 05' : 'Important Coin front';
            log('[' + label + '] ' + reason + ': Sorted ' + touched + ' queues' + (details.length ? ' (' + details.join('; ') + ')' : ''));
        }
    }
    return changed;
}

function enforceForcedSelection(selection, allowIndexFallback, allowSoftMove) {
    var eboxType = parseInt(selection.eboxType, 10);
    var requestedIndex = parseInt(selection.index || '0', 10);
    var desiredItemId = parseInt(selection.itemId || '0', 10);
    var desiredItemPtr = selection.itemPtr || null;
    var entries = readBexlQueueEntries();
    var matching = [];
    var result = {
        ok: false,
        eboxType: eboxType,
        total: 0,
        changed: 0,
        already: 0,
        missing: 0,
        fallback: 0,
        skipped: 0,
        itemId: desiredItemId,
        index: requestedIndex,
        softMode: false,
        softMoved: 0,
        softWaiting: 0,
        bestIndex: 0
    };

    for (var i = 0; i < entries.length; i++) {
        if (entries[i].eboxType === eboxType) matching.push(entries[i]);
    }
    result.total = matching.length;
    if (matching.length === 0) return result;

    if (desiredItemId <= 0 && requestedIndex > 0) {
        for (var qi = 0; qi < matching.length; qi++) {
            var pick = matching[qi];
            if (requestedIndex <= pick.items.length) {
                desiredItemId = pick.items[requestedIndex - 1];
                selection.itemId = desiredItemId;
                result.itemId = desiredItemId;
                break;
            }
        }
    }

    var softMode = shouldUseSoftManualQueueMode(desiredItemId);
    var currentMs = nowMs();
    var softStep = Math.max(1, parseInt(MANUAL_NON_COIN_SOFT_STEP_SLOTS || '1', 10));
    var softCanMove = !softMode || allowSoftMove !== false;
    var softRateOk = !softMode || allowIndexFallback || !selection.softLastMoveAt || currentMs - selection.softLastMoveAt >= MANUAL_NON_COIN_SOFT_MIN_INTERVAL_MS;
    var softMovedThisPass = false;
    result.softMode = softMode;

    for (var mi = 0; mi < matching.length; mi++) {
        var q = matching[mi];
        var targetIndex = desiredItemPtr ? findPointerIndex(q, desiredItemPtr) : -1;
        if (targetIndex < 0 && desiredItemId > 0) targetIndex = findItemIndex(q, desiredItemId);
        var usedFallback = false;

        if (targetIndex < 0 && requestedIndex > 0 && requestedIndex <= q.items.length && (allowIndexFallback || desiredItemId <= 0)) {
            targetIndex = requestedIndex - 1;
            usedFallback = desiredItemId > 0 && q.items[targetIndex] !== desiredItemId;
        }

        if (targetIndex < 0) {
            result.missing++;
            continue;
        }

        if (softMode && targetIndex === 0) {
            result.ok = true;
            result.already++;
            result.bestIndex = result.bestIndex > 0 ? Math.min(result.bestIndex, 1) : 1;
            continue;
        }

        if (softMode && (!softCanMove || !softRateOk)) {
            result.skipped++;
            result.softWaiting++;
            result.bestIndex = result.bestIndex > 0 ? Math.min(result.bestIndex, targetIndex + 1) : targetIndex + 1;
            continue;
        }

        var writeIndex = softMode ? Math.max(0, targetIndex - softStep) : 0;
        var swapped = swapQueueSlots(q, writeIndex, targetIndex);
        if (!swapped.ok) {
            result.skipped++;
            continue;
        }

        result.ok = true;
        if (usedFallback) result.fallback++;
        if (swapped.changed) {
            result.changed++;
            if (softMode) {
                result.softMoved++;
                softMovedThisPass = true;
            }
        } else {
            result.already++;
        }
        result.bestIndex = result.bestIndex > 0 ? Math.min(result.bestIndex, writeIndex + 1) : writeIndex + 1;
    }

    if (softMovedThisPass) selection.softLastMoveAt = currentMs;
    return result;
}

function enforceActiveForcedSelections(reason, verbose) {
    if (!hasActiveForcedSelections()) return false;
    var changed = false;
    var allowSoftMove = shouldAllowSoftManualMove(reason);
    for (var key in g_forcedSelections) {
        if (!Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) continue;
        var selection = g_forcedSelections[key];
        var result = enforceForcedSelection(selection, false, allowSoftMove);
        if (result.changed > 0) {
            changed = true;
            if (verbose) {
                if (result.softMode) {
                    log('[Manual soft change keep] ' + reason + ': ' + labelForEboxType(result.eboxType) + ' itemId=' + result.itemId + ' Moved forward ' + result.changed + '/' + result.total + ' copies' + (result.bestIndex > 0 ? ', current front #' + result.bestIndex : '') + ', do not force change reward ID');
                } else {
                    log('[Manual pin keep] ' + reason + ': ' + labelForEboxType(result.eboxType) + ' itemId=' + result.itemId + ' Filled to 01, synced ' + (result.changed + result.already) + '/' + result.total + ' copies');
                }
            }
        }
    }
    if (changed) {
        g_snapshots.clear();
        g_queuesDisplayed = false;
    }
    return changed;
}

function clearConsumedForcedSelection(itemId, matches) {
    for (var key in g_forcedSelections) {
        if (!Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) continue;
        var selection = g_forcedSelections[key];
        if (parseInt(selection.itemId || '0', 10) !== itemId) continue;

        var matched = false;
        var headPointerMatch = false;
        for (var i = 0; matches && i < matches.length; i++) {
            var m = matches[i];
            if (m.eboxType === selection.eboxType) {
                matched = true;
                if (m.index === 1 && m.pointerMatch) headPointerMatch = true;
            }
        }
        if (!matched) continue;

        selection.selectedAt = nowMs();
        selection.selectedItemId = itemId;
        if (shouldUseAggressiveRewardFix(itemId)) {
            g_pendingForcedReward = {
                itemId: itemId,
                eboxType: selection.eboxType,
                expiresAt: nowMs() + 10 * 60 * 1000,
                source: 'selected'
            };
            delete g_forcedSelections[key];
            log('[Manual pin] Target selected, removed manual keep, only keeping this reward confirmation: ' + labelForEboxType(selection.eboxType) + ' itemId=' + itemId + (headPointerMatch ? '' : '(Not 01/Hidden cursor hit)'));
        } else {
            delete g_forcedSelections[key];
            log('[Manual soft change safe mode] Target naturally selected, stop keeping: ' + labelForEboxType(selection.eboxType) + ' itemId=' + itemId + ', do not force change reward ID');
        }
        g_snapshots.clear();
        g_queuesDisplayed = false;
        return;
    }
}

function completeForcedSelection(eboxType, itemId, reason) {
    for (var key in g_forcedSelections) {
        if (!Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) continue;
        var selection = g_forcedSelections[key];
        if (selection.eboxType !== eboxType) continue;
        if (itemId > 0 && parseInt(selection.itemId || '0', 10) !== itemId) continue;
        delete g_forcedSelections[key];
        log('[Manual pin] ' + reason + ', stop keeping: ' + labelForEboxType(eboxType) + ' itemId=' + itemId);
    }
}

function findForcedTargetPointer(selection, queues) {
    if (!selection) return null;
    var desiredItemId = parseInt(selection.itemId || '0', 10);
    var desiredItemPtr = selection.itemPtr || null;

    if (desiredItemPtr) {
        for (var qi = 0; qi < queues.length; qi++) {
            var q = queues[qi];
            if (q.eboxType !== selection.eboxType) continue;
            if (findPointerIndex(q, desiredItemPtr) >= 0) return desiredItemPtr;
        }
    }

    if (desiredItemId <= 0) return null;
    for (var i = 0; i < queues.length; i++) {
        var queue = queues[i];
        if (queue.eboxType !== selection.eboxType) continue;
        var itemIndex = findItemIndex(queue, desiredItemId);
        if (itemIndex >= 0 && queue.itemPtrs && queue.itemPtrs[itemIndex]) return queue.itemPtrs[itemIndex];
    }

    return desiredItemPtr;
}

function pointerMatchesForcedQueue(matches, eboxType) {
    if (!matches) return false;
    for (var i = 0; i < matches.length; i++) {
        if (matches[i].pointerMatch && matches[i].eboxType === eboxType) return true;
    }
    return false;
}

function itemMatchesForcedQueue(boxPtr, itemId, selection) {
    if (!selection) return false;
    try {
        var queues = readBexlQueueEntries();
        var boxItemId = 0;
        try {
            if (boxPtr && !boxPtr.isNull()) boxItemId = readBoxDataItemId(boxPtr);
        } catch(e) {}
        for (var i = 0; i < queues.length; i++) {
            var q = queues[i];
            if (q.eboxType !== selection.eboxType) continue;
            if (boxPtr && !boxPtr.isNull() && findPointerIndex(q, boxPtr) >= 0) return true;
            if (itemId > 0 && findItemIndex(q, itemId) >= 0) return true;
            if (boxItemId > 0 && findItemIndex(q, boxItemId) >= 0) return true;
        }
    } catch(e) {}
    return false;
}

function getActiveForcedRewardForBox(boxPtr, rewardItemId) {
    for (var key in g_forcedSelections) {
        if (!Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) continue;
        var selection = g_forcedSelections[key];
        var targetItemId = parseInt(selection.itemId || '0', 10);
        if (targetItemId <= 0) continue;
        if (!shouldUseAggressiveRewardFix(targetItemId)) continue;
        if (itemMatchesForcedQueue(boxPtr, rewardItemId, selection)) {
            return { itemId: targetItemId, eboxType: selection.eboxType, selection: selection, matched: true };
        }
    }
    return null;
}

function shouldForceQueueHeadAward(q) {
    if (!q || !q.items || q.items.length === 0) return false;
    var headItemId = parseInt(q.items[0] || '0', 10);
    if (!isPlausibleItemId(headItemId)) return false;
    if (hasForcedSelectionForEboxType(q.eboxType)) return isImportantCoinItemId(headItemId);
    return (AUTO_IMPORTANT_COIN_HEAD && isImportantCoinItemId(headItemId)) || (AUTO_ARCANA_TOP5 && isArcanaGearOrMaterialItemId(headItemId));
}

function findVisibleHeadRewardForBox(boxPtr, rewardItemId, queuesOverride) {
    if (!boxPtr || boxPtr.isNull()) return null;
    var queues = queuesOverride || readBexlQueueEntries();
    var best = null;
    for (var i = 0; i < queues.length; i++) {
        var q = queues[i];
        if (!shouldForceQueueHeadAward(q)) continue;
        if (!q.itemPtrs || !q.itemPtrs[0]) continue;
        var selectedIndex = findPointerIndex(q, boxPtr);
        if (selectedIndex < 0) continue;

        var headItemId = parseInt(q.items[0] || '0', 10);
        if (!isPlausibleItemId(headItemId)) continue;

        var priority = (q.eboxType === 1 ? 100 : 0) + (hasForcedSelectionForEboxType(q.eboxType) ? 20 : 0) + (isImportantCoinItemId(headItemId) ? 10 : 0) - selectedIndex;
        if (!best || priority > best.priority) {
            best = {
                itemId: headItemId,
                eboxType: q.eboxType,
                label: q.label,
                targetPtr: q.itemPtrs[0],
                selectedIndex: selectedIndex + 1,
                sourceIndex: q.sourceIndex,
                entryIndex: q.entryIndex,
                matched: selectedIndex === 0,
                priority: priority,
                reason: hasForcedSelectionForEboxType(q.eboxType) ? 'manual-coin-head' : (isImportantCoinItemId(headItemId) ? 'coin-head' : 'arcana-head')
            };
        }
    }
    return best;
}

function getActiveRewardForBox(boxPtr, rewardItemId, queuesOverride) {
    var forcedReward = getActiveForcedRewardForBox(boxPtr, rewardItemId);
    if (forcedReward && forcedReward.itemId > 0) return forcedReward;
    return findVisibleHeadRewardForBox(boxPtr, rewardItemId, queuesOverride);
}

function forceBoxRewardId(boxPtr, targetItemId, sourceName) {
    if (!boxPtr || boxPtr.isNull() || targetItemId <= 0) return false;
    try {
        var oldRewardItemId = readBoxDataRewardItemId(boxPtr);
        if (oldRewardItemId !== targetItemId) {
            writeBoxDataRewardItemId(boxPtr, targetItemId);
            log('[Manual pin reward pre-write/' + sourceName + '] rewardItemId=' + oldRewardItemId + ' -> ' + targetItemId);
        }
        return true;
    } catch(e) {
        log('[Manual pin reward pre-write/' + sourceName + '] Write failed: ' + e);
    }
    return false;
}

function maybeReplaceVisibleHeadReturn(ret, itemId, preQueues, sourceName) {
    if (!ret || ret.isNull() || !preQueues) return null;
    var headReward = findVisibleHeadRewardForBox(ret, itemId, preQueues);
    if (!headReward || headReward.itemId <= 0 || !headReward.targetPtr || headReward.targetPtr.isNull()) return null;
    if (!shouldUseAggressiveRewardFix(headReward.itemId)) return null;

    try {
        forceBoxRewardId(ret, headReward.itemId, sourceName + ':head-old');
        forceBoxRewardId(headReward.targetPtr, headReward.itemId, sourceName + ':head-target');
        if (!headReward.targetPtr.equals(ret)) {
            ret.replace(headReward.targetPtr);
            log('[Pin 01 distribution correction/' + sourceName + '] ' + headReward.label + ' #' + headReward.selectedIndex + ' ' + itemId + ' -> 01 ' + headReward.itemId + ' / ' + headReward.reason);
        }
        g_pendingForcedReward = {
            itemId: headReward.itemId,
            eboxType: headReward.eboxType,
            expiresAt: nowMs() + 10 * 60 * 1000,
            source: sourceName + ':visible-head'
        };
        return { ptr: headReward.targetPtr, itemId: headReward.itemId, selection: null, visibleHead: headReward };
    } catch(e) {
        log('[Pin 01 distribution correction/' + sourceName + '] Failed to replace return value: ' + e);
    }
    return null;
}

function maybeReplaceForcedReturn(ret, itemId, matchedBefore, preQueues, sourceName) {
    if (!ret || ret.isNull() || !matchedBefore || !preQueues) return null;
    for (var key in g_forcedSelections) {
        if (!Object.prototype.hasOwnProperty.call(g_forcedSelections, key)) continue;
        var selection = g_forcedSelections[key];
        if (!pointerMatchesForcedQueue(matchedBefore.matches, selection.eboxType)) continue;

        var targetPtr = findForcedTargetPointer(selection, preQueues);
        if (!targetPtr || targetPtr.isNull()) continue;

        var targetItemId = 0;
        try { targetItemId = readBoxDataItemId(targetPtr); } catch(e) {}
        if (targetItemId <= 0) targetItemId = parseInt(selection.itemId || '0', 10);
        if (targetItemId <= 0) continue;
        if (!shouldUseAggressiveRewardFix(targetItemId)) {
            var safeLogAt = nowMs();
            if (safeLogAt - g_lastSafeManualLogAt > 3000) {
                g_lastSafeManualLogAt = safeLogAt;
                log('[Manual soft change safe mode/' + sourceName + '] ' + labelForEboxType(selection.eboxType) + ' itemId=' + targetItemId + ' only soft change queue, skip forcing reward ID/return value correction');
            }
            continue;
        }

        try {
            forceBoxRewardId(ret, targetItemId, sourceName + ':old');
            forceBoxRewardId(targetPtr, targetItemId, sourceName + ':target');
            if (!targetPtr.equals(ret)) {
                ret.replace(targetPtr);
                log('[Manual pin selection correction/' + sourceName + '] ' + labelForEboxType(selection.eboxType) + ' ' + itemId + ' -> ' + targetItemId);
            }
            g_pendingForcedReward = {
                itemId: targetItemId,
                eboxType: selection.eboxType,
                expiresAt: nowMs() + 10 * 60 * 1000,
                source: sourceName
            };
            selection.selectedAt = nowMs();
            selection.selectedItemId = targetItemId;
            delete g_forcedSelections[key];
            g_snapshots.clear();
            g_queuesDisplayed = false;
            log('[Manual pin selection correction/' + sourceName + '] target selected, remove manual keep immediately: ' + labelForEboxType(selection.eboxType) + ' itemId=' + targetItemId);
            return { ptr: targetPtr, itemId: targetItemId, selection: selection };
        } catch(e) {
            log('[Manual pin selection correction/' + sourceName + '] Failed to replace return value: ' + e);
        }
    }
    return maybeReplaceVisibleHeadReturn(ret, itemId, preQueues, sourceName);
}

function applyForcedSelection(cmd) {
    try {
        refreshVwInstance();
        var eboxType = parseInt(cmd.eboxType, 10);
        var requestedIndex = parseInt(cmd.index || '0', 10);
        var targetItemId = parseInt(cmd.itemId || '0', 10);
        var rawQueues = readBexlQueueEntries();
        var queues = compactBexlQueues(rawQueues);
        var displayQueue = null;
        var q = null;

        for (var i = 0; i < queues.length; i++) {
            if (queues[i].eboxType === eboxType) {
                displayQueue = queues[i];
                break;
            }
        }

        if (!displayQueue) {
            send({ type: 'force_result', ok: false, message: 'Target drop queue not found eboxType=' + eboxType });
            return;
        }

        var targetIndex = -1;
        var desiredItemId = targetItemId;
        if (targetItemId > 0) {
            var displayIndex = findItemIndex(displayQueue, targetItemId);
            if (displayIndex >= 0) {
                q = displayQueue;
                targetIndex = displayIndex;
            } else {
                for (var j = 0; j < rawQueues.length; j++) {
                    if (rawQueues[j].eboxType !== eboxType) continue;
                    var rawIndex = findItemIndex(rawQueues[j], targetItemId);
                    if (rawIndex < 0) continue;
                    q = rawQueues[j];
                    targetIndex = rawIndex;
                    break;
                }
            }
            desiredItemId = targetItemId;
        } else if (requestedIndex > 0) {
            q = displayQueue;
            targetIndex = requestedIndex - 1;
            if (targetIndex >= 0 && targetIndex < q.items.length) desiredItemId = q.items[targetIndex];
        }

        if (targetItemId > 0 && (targetIndex < 0 || !q)) {
            send({ type: 'force_result', ok: false, message: 'Target Item ID is not in current ' + labelForEboxType(eboxType) + ' queue: ' + targetItemId });
            return;
        }

        if (!q) q = displayQueue;

        if (targetIndex < 0 || targetIndex >= q.items.length) {
            send({ type: 'force_result', ok: false, message: 'Target not in current queue. Please input index 1-' + q.items.length + ' or Item ID in the current list' });
            return;
        }

        var selection = {
            eboxType: eboxType,
            index: targetIndex + 1,
            itemId: desiredItemId,
            itemPtr: q.itemPtrs && q.itemPtrs[targetIndex] ? q.itemPtrs[targetIndex] : null,
            createdAt: nowMs(),
            selectedAt: 0,
            softLastMoveAt: 0
        };
        var softMode = shouldUseSoftManualQueueMode(desiredItemId);
        var result = enforceForcedSelection(selection, true, true);

        if (!result.ok) {
            send({ type: 'force_result', ok: false, message: 'Pin failed: no writable ' + labelForEboxType(eboxType) + ' queue' });
            return;
        }

        g_forcedSelections[String(eboxType)] = selection;

        g_snapshots.clear();
        g_queuesDisplayed = false;
        var synced = result.changed + result.already;
        var softMessage = 'Started manual soft change: #' + (targetIndex + 1) + ' item itemId=' + desiredItemId + ' will gradually move to 01, only change queue, do not force change reward ID';
        if (result.bestIndex > 0) softMessage += ', current front #' + result.bestIndex;
        softMessage += ' (Sync ' + synced + '/' + result.total + ' copies of ' + labelForEboxType(eboxType) + ' queue)';
        var message = 'Pinned #' + (targetIndex + 1) + ' to 01 (Sync ' + synced + '/' + result.total + ' copies of ' + labelForEboxType(eboxType) + ' queue)';
        if (result.fallback > 0) {
            message += '; ' + result.fallback + ' copies not found same item, pinned by index instead';
        }
        if (softMode) message = softMessage;
        send({
            type: 'force_result',
            ok: true,
            message: message,
            eboxType: eboxType,
            itemId: desiredItemId,
            index: targetIndex + 1
        });
        showBexlQueues('Manual pin', true);
    } catch(e) {
        send({ type: 'force_result', ok: false, message: 'Pin failed: ' + e });
    }
}

function sendBossDropQueueFromMemory() {
    try {
        refreshVwInstance();
        var queues = readBexlQueues();
        var bossQueue = null;
        for (var i = 0; i < queues.length; i++) {
            if (queues[i].eboxType === 1) {
                bossQueue = queues[i];
                break;
            }
        }
        if (!bossQueue) {
            send({
                type: 'boss_queue',
                ok: false,
                message: 'Boss drop queue not read, enter map/loot box/switch map to refresh'
            });
            return;
        }
        send({
            type: 'boss_queue',
            ok: true,
            source: 'Real-time game memory read',
            queue: {
                eboxType: bossQueue.eboxType,
                label: bossQueue.label,
                size: bossQueue.size,
                items: bossQueue.items.slice()
            }
        });
    } catch(e) {
        send({ type: 'boss_queue', ok: false, message: 'Failed to read Boss drop: ' + e });
    }
}

function validCachedPtr(p) {
    try { return p && !p.isNull() && p.compare(ptr('0x10000')) > 0; } catch(e) { return false; }
}

function cacheUIPortalInstance(instance, source) {
    if (!validCachedPtr(instance)) return;
    g_lastUIPortal = instance;
    var key = ptrKey(instance);
    if (key && key !== g_lastUIPortalKey) {
        g_lastUIPortalKey = key;
        log('✓ Captured UI_Portal instance by ' + (source || 'unknown') + ' @ ' + key);
    }
    cachePortalStageMaps(instance, source || 'UI_Portal');
}

function cacheStageManagerInstance(instance, source) {
    if (!validCachedPtr(instance)) return;
    g_lastStageManager = instance;
}

function methodParamCount(key) {
    try {
        if (foundMeta[key] && typeof foundMeta[key].argc === 'number') return foundMeta[key].argc;
    } catch(e) {}
    return -1;
}

function readIntArg(args, index) {
    try { return args[index].toInt32(); } catch(e) { return 0; }
}

function readPointerField(instance, key, fallback) {
    try {
        if (!validCachedPtr(instance)) return ptr(0);
        var offset = metadataOffset(key, fallback);
        if (typeof offset !== 'number' || offset < 0) return ptr(0);
        var value = instance.add(offset).readPointer();
        return value && !value.isNull() ? value : ptr(0);
    } catch(e) {
        return ptr(0);
    }
}

function readS32Field(instance, key, fallback) {
    try {
        if (!validCachedPtr(instance)) return 0;
        var offset = metadataOffset(key, fallback);
        if (typeof offset !== 'number' || offset < 0) return 0;
        return instance.add(offset).readS32();
    } catch(e) {
        return 0;
    }
}

function difficultyName(difficulty) {
    difficulty = parseInt(difficulty || '0', 10) || 0;
    if (difficulty === 0) return 'Normal';
    if (difficulty === 1) return 'Nightmare';
    if (difficulty === 2) return 'Hell';
    if (difficulty === 3) return 'Torment';
    return 'Difficulty ' + difficulty;
}

function autoStageTargetLabel(level, difficulty) {
    return difficultyName(difficulty) + ' Level ' + level;
}

function normalizeDifficulty(difficulty) {
    difficulty = parseInt(difficulty || '0', 10) || 0;
    if (difficulty < 0 || difficulty > 20) return 0;
    return difficulty;
}

function stageLevelMapKey(level, difficulty) {
    return String(normalizeDifficulty(difficulty)) + ':' + String(parseInt(level || '0', 10) || 0);
}

function isPlausibleStageLevel(level) {
    level = parseInt(level || '0', 10) || 0;
    return level > 0 && level <= AUTO_STAGE_MAX_ID;
}

function normalizeStageTarget(rawA, rawB, source) {
    var a = parseInt(rawA || '0', 10) || 0;
    var b = parseInt(rawB || '0', 10) || 0;
    var stageId = 0;
    var difficulty = 0;

    if (a > 0 && b > 0) {
        if (a <= 20 && b > 20) {
            difficulty = a;
            stageId = b;
            var argOrder = 'difficulty_stage';
        } else if (b <= 20 && a > 20) {
            difficulty = b;
            stageId = a;
            var argOrder = 'stage_difficulty';
        } else {
            difficulty = a;
            stageId = b;
            var argOrder = 'difficulty_stage';
        }
    } else if (a > 0) {
        stageId = a;
        var argOrder = 'stage';
    } else if (b > 0) {
        stageId = b;
        var argOrder = 'stage';
    }

    if (difficulty <= 0 && stageId > 0 && stageId <= 20) {
        return { stageId: 0, level: 0, difficulty: 0, rawA: a, rawB: b, argOrder: argOrder || '', source: source || '' };
    }
    if (stageId > AUTO_STAGE_MAX_ID) {
        return { stageId: 0, level: 0, difficulty: 0, rawA: a, rawB: b, argOrder: argOrder || '', source: source || '' };
    }
    difficulty = normalizeDifficulty(difficulty);
    return { stageId: stageId, level: stageId, difficulty: difficulty, rawA: a, rawB: b, argOrder: argOrder || '', source: source || '' };
}

function rememberStageSeen(stageId, difficulty, source, rawA, rawB, options) {
    try {
        options = options || {};
        if (g_autoStageSwitchExecuting && !options.force) return;
        stageId = parseInt(stageId || '0', 10);
        difficulty = parseInt(difficulty || '0', 10) || 0;
        if (stageId <= 0) return;
        var reliableNormalStage = !!(options.current || options.stageKey || options.force);
        if (difficulty <= 0 && stageId <= 20 && !reliableNormalStage) return;
        var key = String(difficulty) + ':' + String(stageId);
        var now = nowMs();
        if (options.current) {
            if (g_lastStageSeenKey === key && now - g_lastStageSeenAt < 5000) return;
        } else if (g_seenStageIds[key]) {
            return;
        }
        g_seenStageIds[key] = true;
        g_lastStageSeenKey = key;
        g_lastStageSeenAt = now;
        send({
            type: 'stage_seen',
            stageId: stageId,
            level: stageId,
            stageKey: options.stageKey || 0,
            difficulty: difficulty,
            source: source || '',
            current: !!options.current,
            rawA: parseInt(rawA || '0', 10) || 0,
            rawB: parseInt(rawB || '0', 10) || 0
        });
    } catch(e) {}
}

function methodParamTypeNames(method, argc) {
    var names = [];
    for (var i = 0; i < argc; i++) {
        var typeName = '';
        try {
            var typePtr = mgp(method, i);
            if (typePtr && !typePtr.isNull()) typeName = readStr(tgn(typePtr));
        } catch(e) {}
        names.push(typeName || '?');
    }
    return names;
}

function looksLikeIntType(typeName) {
    return typeName === 'System.Int32' || typeName === 'int' || typeName === 'System.UInt32' || typeName === 'uint';
}

function methodFlags(method) {
    if (!mgf) return 0;
    try {
        var iflags = Memory.alloc(4);
        iflags.writeU32(0);
        return mgf(method, iflags) >>> 0;
    } catch(e) {
        return 0;
    }
}

function isStaticMethod(method) {
    return (methodFlags(method) & 0x0010) !== 0;
}

function isNoisyStageProbeMethod(classLabel, methodName, paramTypes) {
    var key = classLabel + '.' + methodName;
    if (NOISY_STAGE_PROBE_METHODS[key]) return true;
    for (var i = 0; i < paramTypes.length; i++) {
        var p = paramTypes[i] || '';
        if (p.indexOf('EMonsterType') !== -1) return true;
        if (classLabel === 'StageManager' && p === 'System.Single') return true;
    }
    return false;
}

function registerAutoStagePortalMethod(classLabel, methodName, argc, retName, paramTypes, fp) {
    if (classLabel !== 'UI_Portal') return;
    if (!fp || fp.isNull()) return;
    var info = {
        classLabel: classLabel,
        methodName: methodName,
        key: classLabel + '.' + methodName,
        fp: fp,
        argc: argc,
        retName: retName || '',
        paramTypes: paramTypes.slice()
    };
    var first = paramTypes.length > 0 ? (paramTypes[0] || '') : '';
    var second = paramTypes.length > 1 ? (paramTypes[1] || '') : '';
    var retIsBool = (retName || '').indexOf('Boolean') !== -1;
    var retIsVoid = (retName || '').indexOf('Void') !== -1;

    if (argc === 2 && ((first.indexOf('ESTAGEDIFFICULTY') !== -1 && looksLikeIntType(second)) || (looksLikeIntType(first) && (looksLikeIntType(second) || second.indexOf('ESTAGEDIFFICULTY') !== -1)))) {
        g_autoStagePortalMethods.difficultyStage.push(info);
        log('✓ Auto-stage portal candidate difficulty+stage: ' + info.key + '(' + paramTypes.join(',') + ') -> ' + retName);
        return;
    }
    if (argc === 1 && looksLikeIntType(first) && retIsVoid) {
        g_autoStagePortalMethods.stageOnlyVoid.push(info);
        log('✓ Auto-stage portal candidate stage void: ' + info.key + '(' + paramTypes.join(',') + ')');
        return;
    }
    if (argc === 1 && looksLikeIntType(first) && retIsBool) {
        g_autoStagePortalMethods.stageOnlyBool.push(info);
        log('✓ Auto-stage portal candidate stage bool: ' + info.key + '(' + paramTypes.join(',') + ')');
    }
}

function isStageProbeCandidate(classLabel, methodName, argc, retName, paramTypes) {
    if (argc < 1 || argc > 4) return false;
    if (isNoisyStageProbeMethod(classLabel, methodName, paramTypes)) return false;
    var hasRelevantParam = false;
    var allUnknown = true;
    for (var i = 0; i < paramTypes.length; i++) {
        var p = paramTypes[i] || '';
        if (p !== '?' && p !== '') allUnknown = false;
        if (looksLikeIntType(p) || p.indexOf('Stage') !== -1 || p.indexOf('Portal') !== -1) {
            hasRelevantParam = true;
            break;
        }
    }
    if (!hasRelevantParam && allUnknown && (classLabel === 'StageManager' || classLabel === 'UI_Portal')) hasRelevantParam = true;
    if (!hasRelevantParam) return false;
    if (classLabel === 'StageManager') return true;
    if (classLabel === 'UI_Portal') return true;
    if (classLabel === 'StageNode') return true;
    return false;
}

function emitStageProbe(classLabel, methodName, paramTypes, args, source) {
    try {
        var key = classLabel + '.' + methodName;
        if (isNoisyStageProbeMethod(classLabel, methodName, paramTypes)) return;

        var intValues = [];
        var rawValues = [];
        for (var i = 0; i < paramTypes.length; i++) {
            var typeName = paramTypes[i] || '';
            if (looksLikeIntType(typeName) || typeName === '?' || typeName === '') {
                var intValue = readIntArg(args, i + 1);
                intValues.push(intValue);
                rawValues.push(intValue);
            } else {
                var ptrText = '';
                try { ptrText = args[i + 1] ? args[i + 1].toString() : 'null'; } catch(e) { ptrText = '?'; }
                rawValues.push(ptrText);
            }
        }

        var target = normalizeStageTarget(intValues.length > 0 ? intValues[0] : 0, intValues.length > 1 ? intValues[1] : 0, key);
        if (target.stageId > 0) {
            if (classLabel === 'StageManager' && target.argOrder && target.argOrder !== 'stage') g_stageManagerArgOrder = target.argOrder;
            if (classLabel === 'UI_Portal' && target.argOrder && target.argOrder !== 'stage') g_portalArgOrder = target.argOrder;
            rememberStageSeen(target.stageId, target.difficulty, key, intValues.length > 0 ? intValues[0] : 0, intValues.length > 1 ? intValues[1] : 0);
        } else if (!SEND_UNRECOGNIZED_STAGE_PROBES) {
            return;
        }

        if (!SEND_STAGE_PROBE_EVENTS) return;

        var now = nowMs();
        var last = g_stageProbeLastAt[key] || 0;
        var intervalMs = target.stageId > 0 ? 5000 : 15000;
        if (now - last < intervalMs) return;
        g_stageProbeLastAt[key] = now;
        if (g_stageProbeCount > 80) return;
        g_stageProbeCount++;

        send({
            type: 'stage_probe',
            method: key,
            source: source || '',
            paramTypes: paramTypes.slice(),
            rawValues: rawValues,
            intValues: intValues,
            stageId: target.stageId,
            level: target.stageId,
            difficulty: target.difficulty
        });
    } catch(e) {}
}

function hookStageProbeMethod(method, classLabel, methodName, argc, retName, paramTypes) {
    try {
        var fp = method.readPointer();
        if (!fp || fp.isNull()) return false;
        var key = fp.toString();
        if (g_stageProbeHooked[key]) return false;
        g_stageProbeHooked[key] = true;
        registerAutoStagePortalMethod(classLabel, methodName, argc, retName, paramTypes, fp);
        var methodKey = classLabel + '.' + methodName;
        var shouldForceBoolReturn = (retName || '').indexOf('Boolean') !== -1 && (classLabel === 'UI_Portal' || classLabel === 'StageNode');
        Interceptor.attach(fp, {
            onEnter: function(args) {
                if (classLabel === 'UI_Portal') {
                    cacheUIPortalInstance(args[0], methodKey);
                    clearPortalCooldownTimers(args[0], methodKey);
                }
                if (classLabel === 'StageManager') cacheStageManagerInstance(args[0], methodKey);
                if (classLabel === 'StageNode' && methodName === 'hrq') cacheStageCacheInfo(args[1], methodKey);
                if (classLabel === 'StageManager' && methodName === 'igs') {
                    var stageKey = readIntArg(args, 1);
                    var mapped = g_stageKeyInfoMap[String(stageKey)];
                    if (mapped) {
                        g_lastCurrentLevel = mapped.level;
                        rememberStageSeen(mapped.level, mapped.difficulty, methodKey, stageKey, 0, { stageKey: stageKey });
                    }
                }
                emitStageProbe(classLabel, methodName, paramTypes, args, 'probe');
            },
            onLeave: function(ret) {
                if (BYPASS_STAGE_SWITCH_LIMIT && shouldForceBoolReturn) {
                    try {
                        if (ret.toInt32() === 0) {
                            ret.replace(ptr(1));
                            logStageBypass('probe.' + methodKey, '[auto-stage bypass] ' + methodKey + ' false -> true', 1200);
                        }
                    } catch(e) {}
                }
                if (classLabel === 'UI_Portal') runPendingAutoStageSwitch(methodKey);
            }
        });
        log('✓ Stage probe hooked ' + classLabel + '.' + methodName + '(' + argc + ') -> ' + retName + ' params=' + paramTypes.join(','));
        return true;
    } catch(e) {
        return false;
    }
}

function hookStageProbeClass(img, ns, klass, classLabel) {
    var k = cfn(img, cstr(ns), cstr(klass));
    if (!k || k.isNull()) return 0;
    var iter = Memory.alloc(Process.pointerSize);
    iter.writePointer(ptr(0));
    var hooked = 0;
    var scanned = 0;
    while (scanned < 240) {
        var method = cgm(k, iter);
        if (!method || method.isNull()) break;
        scanned++;
        var methodName = readStr(mgn(method));
        if (!methodName) continue;
        var argc = -1;
        var retName = '';
        try { argc = mgpc(method); } catch(e) {}
        try { retName = readStr(tgn(mgrt(method))); } catch(e) {}
        var paramTypes = methodParamTypeNames(method, argc);
        if (!isStageProbeCandidate(classLabel, methodName, argc, retName, paramTypes)) continue;
        if (hookStageProbeMethod(method, classLabel, methodName, argc, retName, paramTypes)) hooked++;
    }
    if (hooked > 0) log('✓ Stage probe ' + classLabel + ': hooked ' + hooked + ' candidate methods');
    return hooked;
}

function hookStageProbeDiscovery() {
    var total = 0;
    for (var a = 0; a < cnt; a++) {
        var asm = asms.add(a * Process.pointerSize).readPointer();
        if (!asm || asm.isNull()) continue;
        var img = aif(asm);
        if (!img || img.isNull()) continue;
        total += hookStageProbeClass(img, 'TaskbarHero', 'StageManager', 'StageManager');
        total += hookStageProbeClass(img, 'TaskbarHero.UI', 'UI_Portal', 'UI_Portal');
        total += hookStageProbeClass(img, 'TaskbarHero', 'StageNode', 'StageNode');
    }
    if (total === 0) log('⚠ Stage probe did not find candidate methods');
}

function shouldHookUIPortalInstanceDiscoveryMethod(methodName, argc) {
    if (!methodName) return false;
    if (methodName.charAt(0) === '.') return false;
    if (argc < 0 || argc > 8) return false;
    return true;
}

function hookUIPortalInstanceDiscoveryMethod(method, methodName, argc, retName) {
    try {
        if (isStaticMethod(method)) return false;
        if (!shouldHookUIPortalInstanceDiscoveryMethod(methodName, argc)) return false;
        var fp = method.readPointer();
        if (!fp || fp.isNull()) return false;
        var fpKey = fp.toString();
        if (g_stageProbeHooked[fpKey] || g_uiPortalInstanceHooked[fpKey]) return false;
        g_uiPortalInstanceHooked[fpKey] = true;
        var methodKey = 'UI_Portal.' + methodName;
        Interceptor.attach(fp, {
            onEnter: function(args) {
                cacheUIPortalInstance(args[0], methodKey);
            },
            onLeave: function(ret) {
                runPendingAutoStageSwitch(methodKey);
            }
        });
        return true;
    } catch(e) {
        return false;
    }
}

function hookUIPortalInstanceDiscoveryClass(img) {
    var k = cfn(img, cstr('TaskbarHero.UI'), cstr('UI_Portal'));
    if (!k || k.isNull()) return 0;
    var iter = Memory.alloc(Process.pointerSize);
    iter.writePointer(ptr(0));
    var hooked = 0;
    var scanned = 0;
    while (scanned < 320) {
        var method = cgm(k, iter);
        if (!method || method.isNull()) break;
        scanned++;
        var methodName = readStr(mgn(method));
        var argc = -1;
        var retName = '';
        try { argc = mgpc(method); } catch(e) {}
        try { retName = readStr(tgn(mgrt(method))); } catch(e) {}
        if (hookUIPortalInstanceDiscoveryMethod(method, methodName, argc, retName)) hooked++;
    }
    return hooked;
}

function hookUIPortalInstanceDiscovery() {
    var total = 0;
    for (var a = 0; a < cnt; a++) {
        var asm = asms.add(a * Process.pointerSize).readPointer();
        if (!asm || asm.isNull()) continue;
        var img = aif(asm);
        if (!img || img.isNull()) continue;
        total += hookUIPortalInstanceDiscoveryClass(img);
    }
    if (total > 0) log('✓ UI_Portal instance discovery hooked ' + total + ' extra methods');
    else log('⚠ UI_Portal instance discovery found no extra methods');
}

function autoStageNativeFunction(key, ret, args, methodKey) {
    methodKey = methodKey || key;
    if (g_autoStageNativeFns[key]) return g_autoStageNativeFns[key];
    if (!found[methodKey]) return null;
    try {
        g_autoStageNativeFns[key] = new NativeFunction(found[methodKey], ret, args);
        return g_autoStageNativeFns[key];
    } catch(e) {
        return null;
    }
}

function autoStageNativeFunctionFromPointer(cacheKey, fp, ret, args) {
    if (g_autoStageNativeFns[cacheKey]) return g_autoStageNativeFns[cacheKey];
    if (!fp || fp.isNull()) return null;
    try {
        g_autoStageNativeFns[cacheKey] = new NativeFunction(fp, ret, args);
        return g_autoStageNativeFns[cacheKey];
    } catch(e) {
        return null;
    }
}

function autoStagePortalCandidateCount() {
    return g_autoStagePortalMethods.difficultyStage.length + g_autoStagePortalMethods.stageOnlyBool.length + g_autoStagePortalMethods.stageOnlyVoid.length;
}

function pushAutoStageFailure(failures, message) {
    if (!message) return;
    for (var i = 0; i < failures.length; i++) {
        if (failures[i] === message) return;
    }
    if (failures.length < 8) failures.push(message);
}

function autoStagePortalReturnType(info) {
    var retName = String(info.retName || '');
    if (retName.indexOf('Void') !== -1) return 'void';
    return 'int';
}

function autoStagePortalResultOk(info, result) {
    var retName = String(info.retName || '');
    if (retName.indexOf('Void') !== -1) return true;
    if (retName.indexOf('Boolean') !== -1) return result !== 0;
    return result === 0;
}

function autoStagePortalResultText(info, result) {
    var retName = String(info.retName || '');
    if (retName.indexOf('Void') !== -1) return 'called';
    if (retName.indexOf('Boolean') !== -1) return 'returned ' + (result !== 0 ? 'true' : 'false');
    return 'returned ' + stageEnterResultName(result);
}

function autoStagePointerCacheKey(info, ret, args) {
    var fpText = '';
    try { fpText = info.fp.toString(); } catch(e) { fpText = info.key; }
    return 'ptr:' + info.key + ':' + fpText + ':' + ret + ':' + args.join(',');
}

function portalDifficultyStageArgs(info, stageId, difficulty) {
    var firstType = info.paramTypes.length > 0 ? String(info.paramTypes[0] || '') : '';
    var secondType = info.paramTypes.length > 1 ? String(info.paramTypes[1] || '') : '';
    var first = difficulty || 0;
    var second = stageId;
    if (secondType.indexOf('ESTAGEDIFFICULTY') !== -1) {
        first = stageId;
        second = difficulty || 0;
    } else if (firstType.indexOf('ESTAGEDIFFICULTY') !== -1) {
        first = difficulty || 0;
        second = stageId;
    } else if (g_portalArgOrder === 'stage_difficulty') {
        first = stageId;
        second = difficulty || 0;
    }
    return { first: first, second: second };
}

function cacheStageInfoData(stageInfoPtr, source) {
    try {
        if (!validCachedPtr(stageInfoPtr)) return null;
        var stageKey = readS32Field(stageInfoPtr, 'StageInfoData.StageKey', 0x30);
        var difficulty = normalizeDifficulty(readS32Field(stageInfoPtr, 'StageInfoData.STAGEDIFFICULTY', 0x44));
        var act = readS32Field(stageInfoPtr, 'StageInfoData.Act', 0x48);
        var stageNo = readS32Field(stageInfoPtr, 'StageInfoData.StageNo', 0x4c);
        var level = readS32Field(stageInfoPtr, 'StageInfoData.StageLevel', 0x50);
        if (!isPlausibleStageLevel(level) || stageKey <= 0) return null;

        var info = {
            stageKey: stageKey,
            difficulty: difficulty,
            act: act,
            stageNo: stageNo,
            level: level,
            source: source || ''
        };
        var key = stageLevelMapKey(level, difficulty);
        var old = g_stageLevelKeyMap[key];
        if (old) {
            if (validCachedPtr(old.nodePtr)) info.nodePtr = old.nodePtr;
            if (validCachedPtr(old.buttonPtr)) info.buttonPtr = old.buttonPtr;
            if (validCachedPtr(old.onClickPtr)) info.onClickPtr = old.onClickPtr;
        }
        g_stageLevelKeyMap[key] = info;
        g_stageKeyInfoMap[String(stageKey)] = info;

        if ((!old || old.stageKey !== stageKey) && !g_stageInfoLogKeys[key]) {
            g_stageInfoLogKeys[key] = true;
            log('✓ Captured map mapping: ' + autoStageTargetLabel(level, difficulty) + ' -> StageKey=' + stageKey + ' Act=' + act + ' StageNo=' + stageNo + ' by ' + (source || 'unknown'));
        }
        if (g_lastCurrentLevel === level) {
            rememberStageSeen(level, difficulty, (source || 'StageInfoData') + '.current-map', stageKey, 0, { current: true, stageKey: stageKey });
        }
        return info;
    } catch(e) {
        return null;
    }
}

function cacheStageCacheInfo(stageCachePtr, source) {
    try {
        if (!validCachedPtr(stageCachePtr)) return null;
        var stageInfoPtr = readPointerField(stageCachePtr, 'StageCache.betl', 0x10);
        return cacheStageInfoData(stageInfoPtr, source);
    } catch(e) {
        return null;
    }
}

function cacheStageNodeInfo(nodePtr, source) {
    try {
        if (!validCachedPtr(nodePtr)) return null;
        var cachePtr = readPointerField(nodePtr, 'StageNode.bdcv', 0x58);
        var info = cacheStageCacheInfo(cachePtr, source);
        if (info) {
            var buttonPtr = readPointerField(nodePtr, 'StageNode.button_Enter', 0x40);
            var onClickPtr = readPointerField(buttonPtr, 'UnityEngine.UI.Button.m_OnClick', 0x100);
            info.nodePtr = nodePtr;
            info.buttonPtr = buttonPtr;
            info.onClickPtr = onClickPtr;
            g_stageLevelKeyMap[stageLevelMapKey(info.level, info.difficulty)] = info;
            g_stageKeyInfoMap[String(info.stageKey)] = info;
        }
        return info;
    } catch(e) {
        return null;
    }
}

function scanStageNodeList(listPtr, source) {
    var count = 0;
    try {
        if (!validCachedPtr(listPtr)) return 0;
        var arr = listPtr.add(0x10).readPointer();
        var size = listPtr.add(0x18).readS32();
        if (!arr || arr.isNull() || size <= 0 || size > 512) return 0;
        for (var i = 0; i < size; i++) {
            try {
                var node = arr.add(0x20 + i * Process.pointerSize).readPointer();
                if (cacheStageNodeInfo(node, source + '#' + i)) count++;
            } catch(inner) {}
        }
    } catch(e) {}
    return count;
}

function cachePortalStageMaps(instance, source) {
    try {
        if (!validCachedPtr(instance)) return 0;
        var difficultyOffset = found['UI_Portal.m_currentStageDifficulty'];
        if (typeof difficultyOffset === 'number' && difficultyOffset >= 0) {
            var portalDifficulty = normalizeDifficulty(instance.add(difficultyOffset).readS32());
            g_lastPortalDifficulty = portalDifficulty;
        }
        var total = 0;
        var listA = readPointerField(instance, 'UI_Portal.bfzh', 0x198);
        var listB = readPointerField(instance, 'UI_Portal.bfzi', 0x1a0);
        total += scanStageNodeList(listA, (source || 'UI_Portal') + '.bfzh');
        total += scanStageNodeList(listB, (source || 'UI_Portal') + '.bfzi');
        return total;
    } catch(e) {
        return 0;
    }
}

function resolveStageInfoForLevel(level, difficulty) {
    level = parseInt(level || '0', 10) || 0;
    difficulty = normalizeDifficulty(difficulty);
    var exact = g_stageLevelKeyMap[stageLevelMapKey(level, difficulty)];
    if (exact) return exact;
    return null;
}

function isStageInfoExactTarget(stageInfo, level, difficulty) {
    if (!stageInfo || !stageInfo.stageKey) return false;
    return parseInt(stageInfo.level || '0', 10) === (parseInt(level || '0', 10) || 0) &&
        normalizeDifficulty(stageInfo.difficulty) === normalizeDifficulty(difficulty);
}

function currentDifficultyHint() {
    if (g_lastCurrentDifficulty >= 0) return normalizeDifficulty(g_lastCurrentDifficulty);
    return normalizeDifficulty(g_lastPortalDifficulty);
}

function rememberPendingStageSwitchConfirm(stageInfo, source) {
    if (!stageInfo || !stageInfo.stageKey) return;
    g_pendingStageSwitchConfirm = {
        stageKey: stageInfo.stageKey,
        level: parseInt(stageInfo.level || '0', 10) || 0,
        difficulty: normalizeDifficulty(stageInfo.difficulty),
        source: source || '',
        at: nowMs()
    };
}

function clearPendingStageSwitchConfirm(source) {
    if (!g_pendingStageSwitchConfirm) return null;
    var pending = g_pendingStageSwitchConfirm;
    g_pendingStageSwitchConfirm = null;
    return pending;
}

function getPendingStageSwitchConfirm() {
    if (!g_pendingStageSwitchConfirm) return null;
    if (nowMs() - g_pendingStageSwitchConfirm.at > 20000) {
        g_pendingStageSwitchConfirm = null;
        return null;
    }
    return g_pendingStageSwitchConfirm;
}

function pendingStageSwitchMatches(level, difficulty) {
    var pending = getPendingStageSwitchConfirm();
    if (!pending) return null;
    level = parseInt(level || '0', 10) || 0;
    difficulty = normalizeDifficulty(difficulty);
    if (pending.level !== level) return null;
    if (pending.difficulty !== difficulty && g_lastCurrentDifficulty >= 0) return null;
    return pending;
}

function notifyPendingStageSwitchFailure(source, resultName) {
    var pending = clearPendingStageSwitchConfirm(source);
    if (!pending) return false;
    send({
        type: 'auto_stage_result',
        ok: false,
        pending: false,
        stageId: pending.level,
        level: pending.level,
        stageKey: pending.stageKey || 0,
        difficulty: pending.difficulty,
        slot: '',
        method: source || '',
        result: null,
        message: 'Game returned ' + (resultName || 'Failed') + ', switch map didn\'t really enter; game cooldown popup kept, waiting for next successful enter to refresh queue'
    });
    return true;
}

function resetDropQueueAfterConfirmedStageSwitch(source, level, difficulty) {
    level = parseInt(level || '0', 10) || 0;
    difficulty = normalizeDifficulty(difficulty);
    if (!isPlausibleStageLevel(level)) return false;

    var now = nowMs();
    var key = stageLevelMapKey(level, difficulty);
    if (g_lastConfirmedStageRefreshKey === key && now - g_lastConfirmedStageRefreshAt < 1200) return false;
    g_lastConfirmedStageRefreshKey = key;
    g_lastConfirmedStageRefreshAt = now;

    var oldOwner = ptrKey(g_vw) || ptrKey(g_lastGoodQueueOwner);
    if (oldOwner) {
        g_stageQueueResetPtr = oldOwner;
        g_stageQueueResetUntil = now + 1800;
    }
    g_vw = null;
    g_lastGoodQueueOwner = null;
    g_snapshots.clear();
    g_queuesDisplayed = false;
    log('✓ [' + (source || 'Confirm map switch') + '] Confirmed map switch: ' + autoStageTargetLabel(level, difficulty) + ', drop queue read reset');
    scheduleQueueChecks((source || 'Confirm map switch'), true);
    return true;
}

function confirmStageSwitchFromGame(source, level, difficulty, stageKey) {
    level = parseInt(level || '0', 10) || 0;
    difficulty = normalizeDifficulty(difficulty);
    if (!isPlausibleStageLevel(level)) return false;
    g_lastCurrentLevel = level;
    g_lastCurrentDifficulty = difficulty;
    g_lastPortalDifficulty = difficulty;
    clearPendingStageSwitchConfirm(source);
    rememberStageSeen(level, difficulty, (source || 'confirmed-stage') + '.confirmed', stageKey || 0, level, { current: true, stageKey: stageKey || 0 });
    return resetDropQueueAfterConfirmedStageSwitch(source, level, difficulty);
}

function markAutoStageTargetCurrent(stageInfo, source) {
    if (!stageInfo || !stageInfo.stageKey) return;
    confirmStageSwitchFromGame(source || 'auto-stage', stageInfo.level, stageInfo.difficulty, stageInfo.stageKey);
}

function currentAutoStageInfo() {
    var level = parseInt(g_lastCurrentLevel || '0', 10) || 0;
    var difficulty = currentDifficultyHint();
    var mapped = resolveStageInfoForLevel(level, difficulty);
    if (mapped) return mapped;
    return {
        stageKey: 0,
        difficulty: difficulty,
        act: 0,
        stageNo: 0,
        level: level
    };
}

function sameDifficultyAndAct(left, right) {
    if (!left || !right) return false;
    var leftDifficulty = normalizeDifficulty(left.difficulty);
    var rightDifficulty = normalizeDifficulty(right.difficulty);
    var leftAct = parseInt(left.act || '0', 10) || 0;
    var rightAct = parseInt(right.act || '0', 10) || 0;
    return leftDifficulty === rightDifficulty && leftAct > 0 && leftAct === rightAct;
}

function setPortalDifficultyField(difficulty) {
    try {
        if (!validCachedPtr(g_lastUIPortal)) {
            return { ok: false, message: 'Stage panel instance not captured yet' };
        }
        var offset = found['UI_Portal.m_currentStageDifficulty'];
        if (typeof offset !== 'number' || offset < 0) {
            return { ok: false, message: 'Stage panel current difficulty field not found' };
        }
        difficulty = normalizeDifficulty(difficulty);
        var field = g_lastUIPortal.add(offset);
        field.writeS32(difficulty);
        var actual = normalizeDifficulty(field.readS32());
        g_lastPortalDifficulty = actual;
        return {
            ok: actual === difficulty,
            message: 'UI_Portal.m_currentStageDifficulty -> ' + difficultyName(actual)
        };
    } catch(e) {
        return { ok: false, message: 'Failed to write stage panel current difficulty: ' + e };
    }
}

function callPortalRefreshNoArg(key, label) {
    if (!found[key]) return null;
    var meta = foundMeta[key] || {};
    if (meta.argc !== 0) return null;
    try {
        ensureIl2cppThreadAttached();
        var retName = String(meta.retName || '');
        var ret = retName.indexOf('Void') !== -1 ? 'void' : 'int';
        var fn = autoStageNativeFunction(key + '.auto-stage-refresh', ret, ['pointer'], key);
        if (!fn) return { ok: false, message: key + ' NativeFunction creation failed' };
        var result = 0;
        if (ret === 'void') fn(g_lastUIPortal);
        else result = fn(g_lastUIPortal);
        return {
            ok: ret === 'void' || result === 0 || result === 1,
            message: key + '(' + (label || 'refresh') + ') ' + (ret === 'void' ? 'called' : ('returned ' + result))
        };
    } catch(e) {
        return { ok: false, message: key + ' refresh call failed: ' + e };
    }
}

function refreshPortalAfterDifficultyChange(failures, details) {
    var keys = ['UI_Portal.lqe', 'UI_Portal.lqw', 'UI_Portal.lqx'];
    for (var i = 0; i < keys.length; i++) {
        var result = callPortalRefreshNoArg(keys[i], 'difficulty-refresh');
        if (!result) continue;
        if (result.ok) {
            if (details) details.push(result.message);
            cachePortalStageMaps(g_lastUIPortal, 'auto-stage-flow.refresh.' + keys[i]);
            return true;
        }
        pushAutoStageFailure(failures, 'Refresh step failed: ' + result.message);
    }
    cachePortalStageMaps(g_lastUIPortal, 'auto-stage-flow.refresh-cache-only');
    return false;
}

function autoStageFlowMessage(steps, details) {
    var prefix = steps.length ? ('Flow executed: ' + steps.join(' -> ')) : 'Flow simulated steps not executed';
    return prefix + (details.length ? '; ' + details.join('; ') : '');
}

function invokePortalStageOnlyMethod(info, value, label) {
    var ret = autoStagePortalReturnType(info);
    var args = ['pointer', 'int'];
    var fn = autoStageNativeFunctionFromPointer(autoStagePointerCacheKey(info, ret, args), info.fp, ret, args);
    if (!fn) return { ok: false, message: info.key + ' NativeFunction creation failed' };

    try {
        ensureIl2cppThreadAttached();
        clearPortalCooldownTimers(g_lastUIPortal, 'auto-stage-flow.' + (label || 'stage-only'));
        var result = 0;
        if (ret === 'void') fn(g_lastUIPortal, value);
        else result = fn(g_lastUIPortal, value);
        return {
            ok: autoStagePortalResultOk(info, result),
            message: info.key + '(' + (label || 'value') + '=' + value + ') ' + autoStagePortalResultText(info, result),
            method: info.key,
            result: result
        };
    } catch(e) {
        return { ok: false, message: info.key + ' call failed: ' + e };
    }
}

function runAutoStagePortalNavigation(stageInfo, currentInfo, source, failures) {
    if (!validCachedPtr(g_lastUIPortal)) {
        pushAutoStageFailure(failures, 'Cross-difficulty/chapter requires capturing stage panel instance; please open stage selection once');
        return null;
    }

    var steps = [];
    var targetDifficulty = normalizeDifficulty(stageInfo.difficulty);
    var targetAct = parseInt(stageInfo.act || '0', 10) || 0;
    var currentDifficulty = currentInfo ? normalizeDifficulty(currentInfo.difficulty) : normalizeDifficulty(g_lastPortalDifficulty);
    var currentAct = currentInfo ? (parseInt(currentInfo.act || '0', 10) || 0) : 0;

    if (targetAct <= 0) {
        pushAutoStageFailure(failures, 'Target map missing chapter info, cannot switch by difficulty->chapter->level flow');
        return null;
    }

    cachePortalStageMaps(g_lastUIPortal, 'auto-stage-flow.before');

    var stepDetails = [];
    if (currentDifficulty !== targetDifficulty) {
        var difficultyResult = setPortalDifficultyField(targetDifficulty);
        if (!difficultyResult.ok) {
            pushAutoStageFailure(failures, 'Difficulty step failed: ' + difficultyResult.message);
            return null;
        }
        steps.push('Difficulty=' + difficultyName(targetDifficulty));
        stepDetails.push(difficultyResult.message);
        refreshPortalAfterDifficultyChange(failures, stepDetails);
        cachePortalStageMaps(g_lastUIPortal, 'auto-stage-flow.after-difficulty');
        currentDifficulty = targetDifficulty;
    }

    if (currentDifficulty !== targetDifficulty || currentAct !== targetAct) {
        var chapterMethods = []
            .concat(g_autoStagePortalMethods.stageOnlyVoid || [])
            .concat(g_autoStagePortalMethods.stageOnlyBool || []);
        if (chapterMethods.length === 0) {
            stepDetails.push('Chapter button entry not captured, skipping chapter simulation, using exact StageKey switch instead');
            return {
                ok: true,
                message: autoStageFlowMessage(steps, stepDetails)
            };
        }

        var chapterOk = false;
        for (var j = 0; j < chapterMethods.length; j++) {
            var chapterResult = invokePortalStageOnlyMethod(chapterMethods[j], targetAct, 'act');
            if (chapterResult.ok) {
                chapterOk = true;
                steps.push('Chapter=' + targetAct);
                stepDetails.push(chapterResult.message);
                break;
            }
            pushAutoStageFailure(failures, 'Chapter step failed: ' + chapterResult.message);
        }
        if (!chapterOk) {
            stepDetails.push('Chapter simulation unsuccessful, skipping, using exact StageKey switch instead');
            return {
                ok: true,
                message: autoStageFlowMessage(steps, stepDetails)
            };
        }
        cachePortalStageMaps(g_lastUIPortal, 'auto-stage-flow.after-act');
    }

    return {
        ok: true,
        message: steps.length ? autoStageFlowMessage(steps, stepDetails) : 'Already at target difficulty and chapter'
    };
}

function callStageNodeButtonSwitch(stageInfo, source) {
    if (!stageInfo || !stageInfo.stageKey) {
        return { ok: false, message: 'Target map node not parsed yet' };
    }
    try {
        ensureIl2cppThreadAttached();
        clearPortalStaticTimers('auto-stage');
        if (validCachedPtr(stageInfo.nodePtr)) {
            forceStageNodeCanChange(stageInfo.nodePtr, 'auto-stage.button-final');
        }
        if (validCachedPtr(stageInfo.buttonPtr) && found['UnityEngine.UI.Button.Press']) {
            var press = autoStageNativeFunction('UnityEngine.UI.Button.Press.auto-stage', 'void', ['pointer'], 'UnityEngine.UI.Button.Press');
            if (press) {
                rememberPendingStageSwitchConfirm(stageInfo, 'StageNode.button_Enter.Press.auto-stage');
                press(stageInfo.buttonPtr);
                return {
                    ok: true,
                    waitConfirm: true,
                    message: 'StageNode.button_Enter.Press(' + autoStageTargetLabel(stageInfo.level, stageInfo.difficulty) + ', StageKey=' + stageInfo.stageKey + ', Act=' + stageInfo.act + ', StageNo=' + stageInfo.stageNo + ') called, waiting for game confirmation to refresh queue @ ' + (source || 'game-thread'),
                    method: 'StageNode.button_Enter.Press',
                    result: 0,
                    stageKey: stageInfo.stageKey
                };
            }
        }

        if (validCachedPtr(stageInfo.onClickPtr) && found['UnityEngine.Events.UnityEvent.Invoke']) {
            var invoke = autoStageNativeFunction('UnityEngine.Events.UnityEvent.Invoke.auto-stage', 'void', ['pointer'], 'UnityEngine.Events.UnityEvent.Invoke');
            if (invoke) {
                rememberPendingStageSwitchConfirm(stageInfo, 'StageNode.button_Enter.onClick.auto-stage');
                invoke(stageInfo.onClickPtr);
                return {
                    ok: true,
                    waitConfirm: true,
                    message: 'StageNode.button_Enter.onClick.Invoke(' + autoStageTargetLabel(stageInfo.level, stageInfo.difficulty) + ', StageKey=' + stageInfo.stageKey + ', Act=' + stageInfo.act + ', StageNo=' + stageInfo.stageNo + ') called, waiting for game confirmation to refresh queue @ ' + (source || 'game-thread'),
                    method: 'StageNode.button_Enter.onClick',
                    result: 0,
                    stageKey: stageInfo.stageKey
                };
            }
        }

        return { ok: false, message: 'Target map node has no callable button_Enter/onClick' };
    } catch(e) {
        clearPendingStageSwitchConfirm('StageNode.button-call-failed');
        return { ok: false, message: 'StageNode button call failed: ' + e };
    }
}

function invokeAutoStagePortalMethod(info, stageId, difficulty, mode) {
    var ret = autoStagePortalReturnType(info);
    var args = mode === 'difficultyStage' ? ['pointer', 'int', 'int'] : ['pointer', 'int'];
    var fn = autoStageNativeFunctionFromPointer(autoStagePointerCacheKey(info, ret, args), info.fp, ret, args);
    if (!fn) return { ok: false, message: info.key + ' NativeFunction creation failed' };

    var oldExecuting = g_autoStageSwitchExecuting;
    g_autoStageSwitchExecuting = true;
    try {
        ensureIl2cppThreadAttached();
        clearPortalCooldownTimers(g_lastUIPortal, 'auto-stage');
        var result = 0;
        var callText = '';
        if (mode === 'difficultyStage') {
            var pair = portalDifficultyStageArgs(info, stageId, difficulty);
            callText = 'arg1=' + pair.first + ', arg2=' + pair.second + ', difficulty=' + (difficulty || 0) + ', stage=' + stageId;
            if (ret === 'void') fn(g_lastUIPortal, pair.first, pair.second);
            else result = fn(g_lastUIPortal, pair.first, pair.second);
        } else {
            callText = 'stage=' + stageId;
            if (ret === 'void') fn(g_lastUIPortal, stageId);
            else result = fn(g_lastUIPortal, stageId);
        }
        return {
            ok: autoStagePortalResultOk(info, result),
            message: info.key + '(' + callText + ') ' + autoStagePortalResultText(info, result),
            method: info.key,
            result: result
        };
    } catch(e) {
        return { ok: false, message: info.key + ' call failed: ' + e };
    } finally {
        g_autoStageSwitchExecuting = oldExecuting;
    }
}

function tryAutoStagePortalList(methods, stageId, difficulty, mode, failures) {
    for (var i = 0; i < methods.length; i++) {
        var result = invokeAutoStagePortalMethod(methods[i], stageId, difficulty, mode);
        if (result.ok) return result;
        pushAutoStageFailure(failures, result.message);
    }
    return null;
}

function callRegisteredPortalAutoSwitch(stageId, difficulty) {
    if (!validCachedPtr(g_lastUIPortal)) {
        return { ok: false, message: 'Stage panel instance not captured yet, please open stage selection once' };
    }

    var failures = [];
    var result = tryAutoStagePortalList(g_autoStagePortalMethods.difficultyStage, stageId, difficulty, 'difficultyStage', failures);
    if (result) {
        result.ok = false;
        result.message = result.message + '; this is only difficulty+level validation, not considered actual successful map switch';
        return result;
    }

    if (autoStagePortalCandidateCount() === 0) {
        return { ok: false, message: 'No available UI_Portal new map switch entry found' };
    }
    return { ok: false, message: failures.length > 0 ? failures.join('; ') : ' UI_Portal difficulty+level validation entry unsuccessful' };
}

function callAutoStageSwitchV52(stageId, difficulty) {
    return { ok: false, message: 'Old auto map switch entry disabled: current version must parse map level to StageKey first, to avoid treating level as chapter' };
}

function callStageManagerStageKeySwitch(stageInfo, source, expectedLevel, expectedDifficulty) {
    if (!stageInfo || !stageInfo.stageKey) {
        return { ok: false, message: 'Target map StageKey not parsed yet' };
    }
    if (!isStageInfoExactTarget(stageInfo, expectedLevel, expectedDifficulty)) {
        return { ok: false, message: 'StageKey mapping and target mismatch, executing non-exact target rejected' };
    }
    if (!found['StageManager.igs']) {
        return { ok: false, message: 'StageManager.igs not found' };
    }
    if (!validCachedPtr(g_lastStageManager)) {
        return { ok: false, message: 'StageManager instance not captured yet, switch map manually once or wait for stage refresh' };
    }
    var fn = autoStageNativeFunction('StageManager.igs.stageKey', 'void', ['pointer', 'int', 'int'], 'StageManager.igs');
    if (!fn) {
        return { ok: false, message: 'StageManager.igs NativeFunction creation failed' };
    }
    try {
        ensureIl2cppThreadAttached();
        clearPortalStaticTimers('auto-stage');
        fn(g_lastStageManager, stageInfo.stageKey, 0);
        markAutoStageTargetCurrent(stageInfo, 'StageManager.igs.auto-stage');
        return {
            ok: true,
            message: 'StageManager.igs(StageKey=' + stageInfo.stageKey + ', ' + autoStageTargetLabel(stageInfo.level, stageInfo.difficulty) + ', Act=' + stageInfo.act + ', StageNo=' + stageInfo.stageNo + ') called @ ' + (source || 'game-thread'),
            method: 'StageManager.igs',
            result: 0,
            stageKey: stageInfo.stageKey
        };
    } catch(e) {
        return { ok: false, message: 'StageManager.igs call failed: ' + e };
    }
}

function callAutoStageSwitchOnGameThread(stageId, difficulty, source) {
    var level = parseInt(stageId || '0', 10) || 0;
    difficulty = normalizeDifficulty(difficulty);
    var failures = [];
    var oldExecuting = g_autoStageSwitchExecuting;
    g_autoStageSwitchExecuting = true;
    try {
        if (validCachedPtr(g_lastUIPortal)) {
            cachePortalStageMaps(g_lastUIPortal, 'auto-stage.' + (source || 'game-thread'));
        }

        var stageInfo = resolveStageInfoForLevel(level, difficulty);
        if (!stageInfo) {
            pushAutoStageFailure(failures, 'Not captured ' + autoStageTargetLabel(level, difficulty) + ' corresponding StageKey; open stage panel or enter this level manually once, let script cache StageLevel->StageKey');
            if (validCachedPtr(g_lastUIPortal)) {
                pushAutoStageFailure(failures, 'Skipped UI_Portal.lrv/lsd(' + level + '), these entries will treat level as chapter and switch incorrectly');
            }
            return { ok: false, message: failures.join(' / ') };
        }
        if (!isStageInfoExactTarget(stageInfo, level, difficulty)) {
            return { ok: false, message: 'StageKey mapping and target mismatch, map switch rejected: Target=' + autoStageTargetLabel(level, difficulty) + ' / Cache=' + autoStageTargetLabel(stageInfo.level, stageInfo.difficulty) + ' StageKey=' + stageInfo.stageKey };
        }

        var currentInfo = currentAutoStageInfo();
        var directAllowed = sameDifficultyAndAct(currentInfo, stageInfo);
        var flowResult = null;
        if (!directAllowed) {
            flowResult = runAutoStagePortalNavigation(stageInfo, currentInfo, source || 'game-thread', failures);
            if (!flowResult || !flowResult.ok) {
                return { ok: false, message: failures.join(' / ') };
            }
        }

        var button = callStageNodeButtonSwitch(stageInfo, source || 'game-thread');
        if (button.ok) {
            if (flowResult && flowResult.message) button.message = flowResult.message + ' / ' + button.message;
            else button.message = 'Same difficulty and chapter, switching level directly / ' + button.message;
            return button;
        }
        pushAutoStageFailure(failures, button.message);
        pushAutoStageFailure(failures, 'StageManager.igs disabled as successful auto map switch path, because it only refreshes script state, doesn\'t really enter map');

        if (failures.length === 0) pushAutoStageFailure(failures, 'Playable map switch game instance not captured yet');
        return { ok: false, message: failures.join(' / ') };
    } finally {
        g_autoStageSwitchExecuting = oldExecuting;
    }
}

function queuePendingAutoStageSwitch(stageId, difficulty, slot) {
    g_pendingAutoStageSwitch = {
        stageId: stageId,
        level: stageId,
        difficulty: difficulty,
        slot: slot || ''
    };
    g_pendingAutoStageSwitchAt = nowMs();
    return {
        ok: false,
        pending: true,
        message: 'Queued to game main thread, waiting for next stage state refresh to execute'
    };
}

function runPendingAutoStageSwitch(source) {
    if (!g_pendingAutoStageSwitch || g_autoStageSwitchExecuting) return false;
    if (!validCachedPtr(g_lastStageManager) && !validCachedPtr(g_lastUIPortal)) return false;
    if (nowMs() - g_pendingAutoStageSwitchAt > 60000) {
        g_pendingAutoStageSwitch = null;
        return false;
    }

    var pending = g_pendingAutoStageSwitch;
    g_pendingAutoStageSwitch = null;
    log('✓ Pending auto-stage switch running on game thread by ' + (source || 'unknown'));
    finishAutoStageSwitchResult(
        pending.stageId,
        pending.difficulty,
        pending.slot,
        callAutoStageSwitchOnGameThread(pending.stageId, pending.difficulty, source || 'game-thread')
    );
    return true;
}

function finishAutoStageSwitchResult(stageId, difficulty, slot, result) {
    send({
        type: 'auto_stage_result',
        ok: !!result.ok,
        pending: !!result.pending,
        stageId: stageId,
        level: stageId,
        stageKey: result.stageKey || 0,
        difficulty: difficulty,
        slot: slot,
        pendingConfirm: !!result.waitConfirm,
        method: result.method || '',
        result: typeof result.result === 'number' ? result.result : null,
        message: result.message || ''
    });

    if (result.ok && !result.waitConfirm) {
        g_snapshots.clear();
        g_queuesDisplayed = false;
        scheduleQueueChecks('Auto map switch', true);
    }
}

function callStageManagerAutoSwitch(stageId, difficulty) {
    if (!found['StageManager.ifo']) {
        return { ok: false, message: 'StageManager.ifo not found' };
    }
    if (!validCachedPtr(g_lastStageManager)) {
        return { ok: false, message: 'StageManager instance not captured yet, switch map manually once or loot box once' };
    }
    var argc = methodParamCount('StageManager.ifo');
    var useTwoArgs = argc >= 2;
    var retName = '';
    try { retName = foundMeta['StageManager.ifo'] ? (foundMeta['StageManager.ifo'].retName || '') : ''; } catch(e) {}
    var returnsVoid = retName.indexOf('Void') !== -1;
    var fn = autoStageNativeFunction('StageManager.ifo' + (useTwoArgs ? '.2' : '.1') + (returnsVoid ? '.void' : '.int'), returnsVoid ? 'void' : 'int', useTwoArgs ? ['pointer', 'int', 'int'] : ['pointer', 'int'], 'StageManager.ifo');
    if (!fn) {
        return { ok: false, message: 'StageManager.ifo NativeFunction creation failed' };
    }
    try {
        ensureIl2cppThreadAttached();
        clearPortalStaticTimers('auto-stage');
        var first = difficulty || 0;
        var second = stageId;
        if (g_stageManagerArgOrder === 'stage_difficulty') {
            first = stageId;
            second = difficulty || 0;
        }
        var result = 0;
        if (returnsVoid) {
            if (useTwoArgs) fn(g_lastStageManager, first, second);
            else fn(g_lastStageManager, stageId);
        } else {
            result = useTwoArgs ? fn(g_lastStageManager, first, second) : fn(g_lastStageManager, stageId);
        }
        return {
            ok: returnsVoid || result === 0,
            message: 'StageManager.ifo(' + (useTwoArgs ? ('arg1=' + first + ', arg2=' + second + ', difficulty=' + (difficulty || 0) + ', stage=' + stageId) : ('stage=' + stageId)) + ') ' + (returnsVoid ? 'called' : ('returned ' + stageEnterResultName(result))),
            method: 'StageManager.ifo',
            result: result
        };
    } catch(e) {
        return { ok: false, message: 'StageManager.ifo call failed: ' + e };
    }
}

function callPortalAutoSwitch(stageId, difficulty) {
    if (!validCachedPtr(g_lastUIPortal)) {
        return { ok: false, message: 'Stage panel instance not captured yet, please open stage selection once' };
    }
    try {
        ensureIl2cppThreadAttached();
        clearPortalCooldownTimers(g_lastUIPortal, 'auto-stage');
    } catch(e) {}

    if (found['UI_Portal.lqi']) {
        var lqi = autoStageNativeFunction('UI_Portal.lqi', 'int', ['pointer', 'int', 'int']);
        if (lqi) {
            try {
                var first = difficulty || 0;
                var second = stageId;
                if (g_portalArgOrder === 'stage_difficulty') {
                    first = stageId;
                    second = difficulty || 0;
                }
                var lqiResult = lqi(g_lastUIPortal, first, second);
                if (lqiResult !== 0) {
                    return {
                        ok: true,
                        message: 'UI_Portal.lqi(arg1=' + first + ', arg2=' + second + ', difficulty=' + (difficulty || 0) + ', stage=' + stageId + ') called, returned true',
                        method: 'UI_Portal.lqi',
                        result: lqiResult
                    };
                }
            } catch(e) {
                return { ok: false, message: 'UI_Portal.lqi call failed: ' + e };
            }
        }
    }

    if (found['UI_Portal.lqf']) {
        var lqf = autoStageNativeFunction('UI_Portal.lqf', 'int', ['pointer', 'int']);
        if (lqf) {
            try {
                var lqfResult = lqf(g_lastUIPortal, stageId);
                return {
                    ok: lqfResult !== 0,
                    message: 'UI_Portal.lqf returned ' + (lqfResult !== 0 ? 'true' : 'false'),
                    method: 'UI_Portal.lqf',
                    result: lqfResult
                };
            } catch(e) {
                return { ok: false, message: 'UI_Portal.lqf call failed: ' + e };
            }
        }
    }

    return { ok: false, message: 'UI_Portal.lqi/lqf not found' };
}

function applyAutoStageSwitch(cmd) {
    var stageId = parseInt(cmd.level || cmd.stageId || '0', 10);
    var difficulty = parseInt(cmd.difficulty || '0', 10) || 0;
    var slot = String(cmd.slot || '');
    if (stageId <= 0) {
        send({ type: 'auto_stage_result', ok: false, stageId: stageId, level: stageId, slot: slot, message: 'Invalid map level' });
        return;
    }

    finishAutoStageSwitchResult(stageId, difficulty, slot, queuePendingAutoStageSwitch(stageId, difficulty, slot));
}

var g_bypassHooked = false;
var g_vwCandidatesHooked = false;

function waitForPanelCommands() {
    recv(function(message) {
        try {
            if (message && message.type === 'force_select') {
                applyForcedSelection(message);
            } else if (message && message.type === 'read_boss_queue') {
                sendBossDropQueueFromMemory();
            } else if (message && message.type === 'auto_stage_switch') {
                applyAutoStageSwitch(message);
            } else if (message && message.type === 'auto_stage_control') {
                send({ type: 'auto_stage_result', ok: true, stageId: 0, slot: '', message: 'Auto map switch stopped' });
            } 
            else if (message && message.type === 'update_config') {
                BYPASS_STAGE_SWITCH_LIMIT = message.bypass_limit;
                AUTO_IMPORTANT_COIN_HEAD = message.auto_coin;
                AUTO_ARCANA_TOP5 = message.auto_arcana;

                if (BYPASS_STAGE_SWITCH_LIMIT && !g_bypassHooked) {
                    g_bypassHooked = true;
                    log('🚀 Bypass Switch ON: Starting to inject core hooks...');
                    hookStageSwitchLimitBypass();
                    
                    if (!found['jsq'] && !g_vwCandidatesHooked) {
                        g_vwCandidatesHooked = true;
                        hookVwDropCandidates();
                    }
                }
            }
        } catch(e) {
            send({ type: 'force_result', ok: false, message: 'Command processing failed: ' + e });
        }
        waitForPanelCommands();
    });
}

function queuesChanged(queues) {
    if (!g_queuesDisplayed) return queues.length > 0;
    if (queues.length !== g_snapshots.size) return true;
    for (var qi = 0; qi < queues.length; qi++) {
        var q = queues[qi];
        var key = queueSnapshotKey(q);
        var old = g_snapshots.get(key);
        if (!old || old.items.length !== q.items.length) return true;
        for (var i = 0; i < q.items.length; i++) {
            if (old.items[i] !== q.items[i]) return true;
        }
    }
    return false;
}

function showBexlQueues(source, forceLog) {
    if (source !== 'Manual pin' && source !== 'Manual pin confirm') {
        enforceActiveForcedSelections(source, forceLog);
    }
    promoteArcanaTop5(source, forceLog);
    var queues = readBexlQueues();
    if (queues.length === 0) {
        if (forceLog) log('[' + source + '] triggered, but drop queue not read temporarily. vw=' + (g_vw && !g_vw.isNull() ? g_vw : 'null'));
        return false;
    }
    if (!queuesChanged(queues)) {
        if (forceLog) log('[' + source + '] triggered, drop queue unchanged. Current queue=' + queues.length + ' items');
        return true;
    }
    g_snapshots.clear();
    for (var qi = 0; qi < queues.length; qi++) {
        var q = queues[qi];
        g_snapshots.set(queueSnapshotKey(q), { eboxType: q.eboxType, label: q.label, items: q.items.slice(), size: q.size });
    }
    log('');
    log('[' + source + '] ' + queues.length + ' drop queues:');
    for (var qi2 = 0; qi2 < queues.length; qi2++) {
        displayQueue(queues[qi2]);
    }
    emitQueues(source, queues);
    g_queuesDisplayed = true;
    return true;
}

function scheduleQueueChecks(source, forceLog) {
    var delays = [100, 300, 750, 1500, 3000, 5000, 8000];
    for (var i = 0; i < delays.length; i++) {
        (function(delay) {
            setTimeout(function() { showBexlQueues(source, forceLog && delay === 750); }, delay);
        })(delays[i]);
    }
}
function onStageSignal(source) {
    var signalAt = nowMs();
    if (signalAt - g_lastStageSignalAt < 1200) return;
    g_lastStageSignalAt = signalAt;
    g_stageEventCount++;
    log('');
    log('>>> [' + source + ' #' + g_stageEventCount + '] map enter/switch/box UI event detected');
    refreshVwInstance();
    showBexlQueues(source + ' check immediately', true);
    scheduleQueueChecks(source, true);
}
function attachSignalHook(key, label, updateVw) {
    if (!found[key]) return false;
    try {
        Interceptor.attach(found[key], {
            onEnter: function(args) {
                if (label.indexOf('StageManager.') === 0) cacheStageManagerInstance(args[0], label);
                if (updateVw && args[0] && !args[0].isNull()) setQueueOwnerIfValid(args[0], label);
                onStageSignal(label);
            }
        });
        log('✓ Hooked ' + label + ' signal');
        return true;
    } catch(e) {
        if (String(e).indexOf('unable to intercept function') !== -1) {
            log('⚠ hook skipped ' + label + ': function cannot be intercepted on this build');
        } else {
            log('ERROR hook ' + label + ': ' + e);
        }
        return false;
    }
}

function stageEnterResultName(value) {
    if (value === 0) return 'Success';
    if (value === 1) return 'FailReasonEndStage';
    if (value === 2) return 'FailReasonNeedSoulStone';
    if (value === 3) return 'FailReasonNeedChestSpace';
    if (value === 4) return 'Failed';
    return 'Unknown(' + value + ')';
}

function logStageBypass(key, message, intervalMs) {
    if (!LOG_STAGE_BYPASS_EVENTS) return;
    var currentMs = nowMs();
    var last = g_stageBypassLogAt[key] || 0;
    if (currentMs - last < intervalMs) return;
    g_stageBypassLogAt[key] = currentMs;
    log(message);
}

var g_setGameObjectActive = null;
var g_abusePopupPtrs = {};
var g_abuseRemainTextPtrs = {};
var g_abuseRemainString = null;

function ptrKey(p) {
    try { return p && !p.isNull() ? p.toString() : ''; } catch(e) { return ''; }
}

function clearPortalStaticTimers(source) {
    if (!BYPASS_STAGE_SWITCH_LIMIT) return false;
    var changed = false;
    try {
        var zero = Memory.alloc(4);
        zero.writeFloat(0.0);
        if (found['UI_Portal.bfxe.field']) {
            fssv(found['UI_Portal.bfxe.field'], zero);
            changed = true;
        }
        if (found['UI_Portal.bfxf.field']) {
            fssv(found['UI_Portal.bfxf.field'], zero);
            changed = true;
        }
    } catch(e) {}
    if (changed) {
        logStageBypass('UI_Portal.cooldown.static', '[Stage Limit Removed] UI_Portal static bfxe/bfxf -> 0 by ' + source, 1200);
    }
    return changed;
}

function ensureGameObjectSetActive() {
    if (!g_setGameObjectActive && found['UnityEngine.GameObject.SetActive']) {
        g_setGameObjectActive = new NativeFunction(found['UnityEngine.GameObject.SetActive'], 'void', ['pointer', 'int']);
    }
    return g_setGameObjectActive;
}

function registerAndHideAbusePopup(instance, source) {
    if (!BYPASS_STAGE_SWITCH_LIMIT || !instance || instance.isNull()) return false;
    var changed = false;
    try {
        if (typeof found['UI_Portal.m_abuseGuardPopup'] === 'number') {
            var popup = instance.add(found['UI_Portal.m_abuseGuardPopup']).readPointer();
            if (popup && !popup.isNull()) {
                g_abusePopupPtrs[ptrKey(popup)] = true;
                var setActive = ensureGameObjectSetActive();
                if (setActive) {
                    setActive(popup, 0);
                    changed = true;
                }
            }
        }
        if (typeof found['UI_Portal.m_abuseGuardRemainText'] === 'number') {
            var remainText = instance.add(found['UI_Portal.m_abuseGuardRemainText']).readPointer();
            if (remainText && !remainText.isNull()) {
                g_abuseRemainTextPtrs[ptrKey(remainText)] = true;
            }
        }
    } catch(e) {}
    if (changed) {
        logStageBypass('UI_Portal.abusePopup.hide', '[Stage Limit Removed] abuse guard popup hidden by ' + source, 1200);
    }
    return changed;
}

function shouldClampAbuseRemainText(selfPtr, text) {
    if (!BYPASS_STAGE_SWITCH_LIMIT) return false;
    if (selfPtr && g_abuseRemainTextPtrs[ptrKey(selfPtr)]) return true;
    if (!text) return false;
    return text.indexOf('剩余时间') !== -1 || text.indexOf('频繁切换关卡') !== -1 || text.indexOf('卡片移动受到限制') !== -1;
}

function clearPortalCooldownTimers(instance, source) {
    clearPortalStaticTimers(source);
    registerAndHideAbusePopup(instance, source);
}

function hookAbusePopupSetActiveBypass() {
    if (!BYPASS_STAGE_SWITCH_LIMIT) {
        log('↷ Skipped abuse guard popup SetActive bypass; game cooldown popup stays visible');
        return false;
    }
    if (!found['UnityEngine.GameObject.SetActive']) return false;
    try {
        Interceptor.attach(found['UnityEngine.GameObject.SetActive'], {
            onEnter: function(args) {
                if (!BYPASS_STAGE_SWITCH_LIMIT) return;
                try {
                    if (g_abusePopupPtrs[ptrKey(args[0])] && args[1].toInt32() !== 0) {
                        args[1] = ptr(0);
                        logStageBypass('UnityEngine.GameObject.SetActive.abusePopup', '[Stage Limit Removed] abuse guard popup SetActive(true) -> false', 1200);
                    }
                } catch(e) {}
            }
        });
        log('✓ Hooked abuse guard popup SetActive bypass');
        return true;
    } catch(e) {
        log('ERROR hook abuse guard popup SetActive bypass: ' + e);
        return false;
    }
}

function hookAbuseRemainTextBypass(key, label) {
    if (!BYPASS_STAGE_SWITCH_REMAIN_TEXT_CLAMP) {
        log('↷ Skipped ' + label + ' remain-text clamp; cooldown text stays normal');
        return false;
    }
    if (!found[key]) return false;
    try {
        Interceptor.attach(found[key], {
            onEnter: function(args) {
                if (!BYPASS_STAGE_SWITCH_LIMIT) return;
                try {
                    var oldText = readIl2cppString(args[1]);
                    if (!shouldClampAbuseRemainText(args[0], oldText)) return;
                    if (!g_abuseRemainString) g_abuseRemainString = makeIl2cppString('Remaining 1 sec');
                    args[1] = g_abuseRemainString;
                    logStageBypass(key + '.remainText', '[Stage Limit Removed] abuse remain text "' + oldText + '" -> "Remaining 1 sec"', 800);
                } catch(e) {}
            }
        });
        log('✓ Hooked ' + label + ' remain-text clamp');
        return true;
    } catch(e) {
        log('ERROR hook ' + label + ' remain-text clamp: ' + e);
        return false;
    }
}

function hookBoolBypass(key, label, describeArg) {
    if (!found[key]) return false;
    try {
        Interceptor.attach(found[key], {
            onEnter: function(args) {
                this.extra = '';
                if (label.indexOf('StageNode.') === 0) forceStageNodeCanChange(args[0], label);
                if (label.indexOf('UI_Portal.') === 0) {
                    cacheUIPortalInstance(args[0], label);
                    clearPortalCooldownTimers(args[0], label);
                }
                try {
                    if (describeArg) this.extra = describeArg(args);
                } catch(e) {}
            },
            onLeave: function(ret) {
                if (!BYPASS_STAGE_SWITCH_LIMIT) return;
                try {
                    var value = ret.toInt32();
                    if (value === 0) {
                        ret.replace(ptr(1));
                        logStageBypass(key, '[Stage Limit Removed] ' + label + (this.extra ? ' ' + this.extra : '') + ' false -> true', 1200);
                    }
                } catch(e) {}
            }
        });
        log('✓ Hooked ' + label + (BYPASS_STAGE_SWITCH_LIMIT ? ' bypass' : ' monitor'));
        return true;
    } catch(e) {
        log('ERROR hook ' + label + ' bypass: ' + e);
        return false;
    }
}

function forceStageNodeCanChange(nodePtr, source) {
    if (!BYPASS_STAGE_SWITCH_LIMIT || !nodePtr || nodePtr.isNull()) return;
    try {
        if (typeof found['StageNode.bdbh'] === 'number') {
            var flag = nodePtr.add(found['StageNode.bdbh']);
            var oldValue = flag.readU8();
            if (oldValue === 0) {
                flag.writeU8(1);
                logStageBypass('StageNode.bdbh', '[Stage Limit Removed] StageNode.bdbh false -> true by ' + source, 800);
            }
        }
    } catch(e) {}
}

function hookStageNodeLimitBypass() {
    if (!BYPASS_STAGE_SWITCH_LIMIT) {
        log('↷ Skipped StageNode stage-only bypass; game cooldown limits stay normal');
        return false;
    }

    if (found['StageNode.hrc']) {
        try {
            Interceptor.attach(found['StageNode.hrc'], {
                onEnter: function(args) {
                    this.node = args[0];
                },
                onLeave: function(ret) {
                    forceStageNodeCanChange(this.node, 'StageNode.hrc');
                }
            });
            log('✓ Hooked StageNode.hrc stage-only bypass');
        } catch(e) {}
    }

    if (found['StageNode.hre']) {
        try {
            Interceptor.attach(found['StageNode.hre'], {
                onEnter: function(args) {
                    forceStageNodeCanChange(args[0], 'StageNode.hre');
                    try {
                        var oldValue = args[1].toInt32();
                        if (oldValue === 0) {
                            args[1] = ptr(1);
                            logStageBypass('StageNode.hre', '[Stage Limit Removed] StageNode.hre false -> true', 800);
                        }
                    } catch(e) {}
                }
            });
            log('✓ Hooked StageNode.hre stage-only bypass');
        } catch(e) {
            log('ERROR hook StageNode.hre bypass: ' + e);
        }
    }

    if (found['StageNode.hrf']) {
        try {
            Interceptor.attach(found['StageNode.hrf'], {
                onEnter: function(args) {
                    forceStageNodeCanChange(args[0], 'StageNode.hrf');
                }
            });
            log('✓ Hooked StageNode.hrf stage-only bypass');
        } catch(e) {
            log('ERROR hook StageNode.hrf bypass: ' + e);
        }
    }
}

function hookStageManagerCurrentStage() {
    if (!found['StageManager.ihr']) {
        log('⚠ StageManager.ihr not found; current-stage refresh hook skipped');
        return false;
    }
    try {
        Interceptor.attach(found['StageManager.ihr'], {
            onEnter: function(args) {
                cacheStageManagerInstance(args[0], 'StageManager.ihr');
                var oldLevel = parseInt(g_lastCurrentLevel || '0', 10) || 0;
                var level = readIntArg(args, 3);
                if (isPlausibleStageLevel(level)) {
                    var difficulty = currentDifficultyHint();
                    var pending = getPendingStageSwitchConfirm();
                    if (pending && pending.level === level) difficulty = pending.difficulty;
                    if (level !== oldLevel) {
                        confirmStageSwitchFromGame('StageManager.ihr.current', level, difficulty, pending ? pending.stageKey : 0);
                    } else {
                        g_lastCurrentLevel = level;
                        rememberStageSeen(level, difficulty, 'StageManager.ihr.current', 0, level, { current: true });
                    }
                }
            },
            onLeave: function(ret) {
                runPendingAutoStageSwitch('StageManager.ihr');
            }
        });
        log('✓ Hooked StageManager.ihr current-stage/main-thread auto-stage');
        return true;
    } catch(e) {
        log('ERROR hook StageManager.ihr current-stage: ' + e);
        return false;
    }
}

function hookBoolArgForce(key, label, argIndex, forcedValue, describeArg) {
    if (!BYPASS_STAGE_SWITCH_LIMIT) {
        log('↷ Skipped ' + label + ' arg-force bypass; game cooldown limits stay normal');
        return false;
    }
    if (!found[key]) return false;
    try {
        Interceptor.attach(found[key], {
            onEnter: function(args) {
                if (!BYPASS_STAGE_SWITCH_LIMIT) return;
                try {
                    clearPortalCooldownTimers(args[0], label);
                    var oldValue = args[argIndex].toInt32();
                    if (oldValue !== forcedValue) {
                        args[argIndex] = ptr(forcedValue);
                        var extra = '';
                        try {
                            if (describeArg) extra = describeArg(args);
                        } catch(e) {}
                        logStageBypass(key, '[Stage Limit Removed] ' + label + (extra ? ' ' + extra : '') + ' arg' + argIndex + '=' + oldValue + ' -> ' + forcedValue, 1200);
                    }
                } catch(e) {}
            }
        });
        log('✓ Hooked ' + label + ' arg-force bypass');
        return true;
    } catch(e) {
        log('ERROR hook ' + label + ' arg-force bypass: ' + e);
        return false;
    }
}

function hookVoidTrace(key, label, describeArg) {
    if (!found[key]) return false;
    try {
        Interceptor.attach(found[key], {
            onEnter: function(args) {
                if (label.indexOf('UI_Portal.') === 0) cacheUIPortalInstance(args[0], label);
                clearPortalCooldownTimers(args[0], label);
                var extra = '';
                try {
                    if (describeArg) extra = describeArg(args);
                } catch(e) {}
                logStageBypass(key + '.trace', '[Stage Limit Trace] ' + label + (extra ? ' ' + extra : '') + ' called', 1200);
            }
        });
        log('✓ Hooked ' + label + ' trace');
        return true;
    } catch(e) {
        log('ERROR hook ' + label + ' trace: ' + e);
        return false;
    }
}

function hookStageSwitchLimitBypass() {
    if (BYPASS_STAGE_SWITCH_LIMIT) {
        clearPortalStaticTimers('startup');
    } else {
        log('↷ Stage switch limit bypass disabled; game cooldown result and popup stay normal');
    }
    // hookStageProbeDiscovery();
    // hookUIPortalInstanceDiscovery();
    hookAbusePopupSetActiveBypass();
    hookAbuseRemainTextBypass('TMPro.TMP_Text.set_text', 'TMPro.TMP_Text.set_text');
    hookAbuseRemainTextBypass('TMPro.TextMeshProUGUI.set_text', 'TMPro.TextMeshProUGUI.set_text');

    if (found['StageManager.ifo']) {
        try {
            Interceptor.attach(found['StageManager.ifo'], {
                onEnter: function(args) {
                    cacheStageManagerInstance(args[0], 'StageManager.ifo');
                    var argc = methodParamCount('StageManager.ifo');
                    var rawA = readIntArg(args, 1);
                    var rawB = argc >= 2 ? readIntArg(args, 2) : 0;
                    var target = normalizeStageTarget(rawA, rawB, 'StageManager.ifo');
                    if (target.argOrder && target.argOrder !== 'stage') g_stageManagerArgOrder = target.argOrder;
                    this.stageId = target.stageId;
                    this.difficulty = target.difficulty;
                    rememberStageSeen(target.stageId, target.difficulty, 'StageManager.ifo', rawA, rawB);
                },
                onLeave: function(ret) {
                    try {
                        if (foundMeta['StageManager.ifo'] && String(foundMeta['StageManager.ifo'].retName || '').indexOf('Void') !== -1) return;
                    } catch(e) {}
                    try {
                        var result = ret.toInt32();
                        if (result === 0) {
                            confirmStageSwitchFromGame('StageManager.ifo', this.stageId, this.difficulty, 0);
                        } else if (result === 4) {
                            notifyPendingStageSwitchFailure('StageManager.ifo', stageEnterResultName(result));
                            if (BYPASS_STAGE_SWITCH_LIMIT) {
                                ret.replace(ptr(0));
                                logStageBypass('StageManager.ifo.' + result, '[Stage Limit Removed] StageManager.ifo difficulty=' + (this.difficulty || 0) + ' stage=' + this.stageId + ' ' + stageEnterResultName(result) + ' -> Success', 800);
                            }
                        }
                    } catch(e) {}
                }
            });
            log('✓ Hooked StageManager.ifo ' + (BYPASS_STAGE_SWITCH_LIMIT ? 'switch-limit bypass' : 'switch-result monitor'));
        } catch(e) {
            log('ERROR hook StageManager.ifo bypass: ' + e);
        }
    } else {
        log('⚠ StageManager.ifo not found; game switch-limit result hook skipped');
    }

    if (found['StageManager.ifn']) {
        try {
            Interceptor.attach(found['StageManager.ifn'], {
                onEnter: function(args) {
                    cacheStageManagerInstance(args[0], 'StageManager.ifn');
                    try {
                        var result = args[1].toInt32();
                        var toast = args[2].toInt32();
                        if (result === 0) {
                            var pendingOk = getPendingStageSwitchConfirm();
                            if (pendingOk) confirmStageSwitchFromGame('StageManager.ifn', pendingOk.level, pendingOk.difficulty, pendingOk.stageKey || 0);
                        } else if (result === 4) {
                            notifyPendingStageSwitchFailure('StageManager.ifn', stageEnterResultName(result));
                            if (BYPASS_STAGE_SWITCH_LIMIT) {
                                args[1] = ptr(0);
                                logStageBypass('StageManager.ifn.' + result, '[Stage Limit Removed] StageManager.ifn toast=' + toast + ' ' + stageEnterResultName(result) + ' -> Success', 1200);
                            }
                        }
                    } catch(e) {}
                }
            });
            log('✓ Hooked StageManager.ifn ' + (BYPASS_STAGE_SWITCH_LIMIT ? 'failure-toast bypass' : 'failure-toast monitor'));
        } catch(e) {
            log('ERROR hook StageManager.ifn bypass: ' + e);
        }
    }

    hookBoolBypass('StageNode.hrd', 'StageNode.hrd', null);
    hookStageNodeLimitBypass();
    hookStageManagerCurrentStage();
    hookBoolBypass('UI_Portal.lqf', 'UI_Portal.lqf(stage-card)', function(args) {
        var rawA = readIntArg(args, 1);
        var target = normalizeStageTarget(rawA, 0, 'UI_Portal.lqf');
        rememberStageSeen(target.stageId, target.difficulty, 'UI_Portal.lqf', rawA, 0);
        return 'raw=' + rawA + ' difficulty=' + target.difficulty + ' stage=' + target.stageId;
    });
    hookBoolBypass('UI_Portal.lqi', 'UI_Portal.lqi(stage-card)', function(args) {
        var rawA = readIntArg(args, 1);
        var rawB = readIntArg(args, 2);
        var target = normalizeStageTarget(rawA, rawB, 'UI_Portal.lqi');
        if (target.argOrder && target.argOrder !== 'stage') g_portalArgOrder = target.argOrder;
        rememberStageSeen(target.stageId, target.difficulty, 'UI_Portal.lqi', rawA, rawB);
        return 'raw=' + rawA + ',' + rawB + ' difficulty=' + target.difficulty + ' stage=' + target.stageId;
    });
    hookBoolArgForce('UI_Portal.lqk', 'UI_Portal.lqk(abuse-popup)', 1, 0, null);
    hookVoidTrace('UI_Portal.lqe', 'UI_Portal.lqe(portal-refresh)', null);
    hookVoidTrace('UI_Portal.lql', 'UI_Portal.lql(public-int)', function(args) {
        var value = 0;
        try { value = args[1].toInt32(); } catch(e) {}
        return 'arg=' + value;
    });
    hookVoidTrace('UI_Portal.lqt', 'UI_Portal.lqt(private-int)', function(args) {
        var value = 0;
        try { value = args[1].toInt32(); } catch(e) {}
        return 'arg=' + value;
    });
    hookVoidTrace('UI_Portal.lqw', 'UI_Portal.lqw(shared)', null);
    hookVoidTrace('UI_Portal.lqx', 'UI_Portal.lqx(shared)', null);
}

function isPlausibleItemId(itemId) {
    return itemId > 0 && itemId < 10000000;
}

function readPlausibleBoxItemId(boxPtr) {
    if (!boxPtr || boxPtr.isNull()) return 0;
    try {
        var itemId = readBoxDataItemId(boxPtr);
        return isPlausibleItemId(itemId) ? itemId : 0;
    } catch(e) {}
    return 0;
}

function readRewardItemIdForDisplay(boxPtr) {
    var rawRewardItemId = 0;
    try {
        rawRewardItemId = readBoxDataRewardItemId(boxPtr);
    } catch(e) {
        return { itemId: 0, raw: 0, source: 'read-failed' };
    }
    
    var decryptedId = readBoxDataItemId(boxPtr);
    if (decryptedId > 0) {
        return { itemId: decryptedId, raw: rawRewardItemId, source: 'DECRYPT' };
    }
    
    return { itemId: 0, raw: rawRewardItemId, source: 'invalid' };
}

function hasPointerMatch(matches) {
    if (!matches) return false;
    for (var i = 0; i < matches.length; i++) {
        if (matches[i].pointerMatch) return true;
    }
    return false;
}

function shouldHookVwDropCandidate(candidate) {
    if (!candidate || !candidate.fp || candidate.fp.isNull()) return false;
    if (!candidate.name || candidate.name === '.ctor' || candidate.name === '.cctor') return false;
    if (candidate.retName && candidate.retName.indexOf('Void') !== -1) return false;
    if (candidate.argc > 3) return false;
    return true;
}

function hookVwDropCandidates() {
    var candidates = found['vwMethodCandidates'] || [];
    var hooked = 0;
    for (var i = 0; i < candidates.length; i++) {
        if (hooked >= 80) break;
        var candidate = candidates[i];
        if (!shouldHookVwDropCandidate(candidate)) continue;
        (function(cand) {
            try {
                Interceptor.attach(cand.fp, {
                    onEnter: function(args) {
                        if (args[0] && !args[0].isNull()) setQueueOwnerIfValid(args[0], 'auto:' + cand.name);
                        enforceActiveForcedSelections('auto:' + cand.name + 'Before ', false);
                        promoteArcanaTop5('auto:' + cand.name + 'Before ', false);
                        this.preQueues = readBexlQueueEntries();
                    },
                    onLeave: function(ret) {
                        if (!ret || ret.isNull()) return;
                        try {
                            var itemId = readBoxDataItemId(ret);
                            if (!isPlausibleItemId(itemId)) return;

                            var matchedBefore = matchSelectedItem(ret, itemId, this.preQueues || []);
                            if (!hasPointerMatch(matchedBefore.matches)) return;
                            var forcedReturn = maybeReplaceForcedReturn(ret, itemId, matchedBefore, this.preQueues || [], 'auto:' + cand.name);
                            var effectiveRet = forcedReturn ? forcedReturn.ptr : ret;
                            if (forcedReturn) {
                                itemId = forcedReturn.itemId;
                                matchedBefore = matchSelectedItem(effectiveRet, itemId, this.preQueues || []);
                            }

                            var currentMs = nowMs();
                            var retText = String(effectiveRet);
                            if (retText === g_lastFallbackSelectedPtr && currentMs - g_lastFallbackSelectedAt < 500) return;
                            g_lastFallbackSelectedPtr = retText;
                            g_lastFallbackSelectedAt = currentMs;

                            var matchedAfter = matchSelectedItem(effectiveRet, itemId);
                            g_dropCount++;
                            log('  [Drop #' + g_dropCount + ' / auto:' + cand.name + '] Selected: ' + itemId);
                            log('    Pre-consume lookup: ' + describeMatchesForLog(matchedBefore.matches));
                            log('    Post-consume lookup: ' + describeMatchesForLog(matchedAfter.matches));
                            clearConsumedForcedSelection(itemId, matchedBefore.matches);
                            send({
                                type: 'selected',
                                count: g_dropCount,
                                itemId: itemId,
                                matches: matchedAfter.matches,
                                heads: matchedAfter.heads,
                                beforeMatches: matchedBefore.matches,
                                beforeHeads: matchedBefore.heads,
                                afterMatches: matchedAfter.matches,
                                afterHeads: matchedAfter.heads
                            });
                            scheduleQueueChecks('After drop', true);
                        } catch(e) {}
                    }
                });
                hooked++;
            } catch(e) {
                log('ERROR hook vw candidate ' + cand.name + ': ' + e);
            }
        })(candidate);
    }
    log('fallback hooked ' + hooked + ' vw drop candidates');
}

// Hook jsq
if (found['jsq']) {
    Interceptor.attach(found['jsq'], {
        onEnter: function(args) {
            if (args[0] && !args[0].isNull()) setQueueOwnerIfValid(args[0], 'jsq');
            enforceActiveForcedSelections('Before drop', true);
            promoteArcanaTop5('Before drop', true);
            this.preQueues = readBexlQueueEntries();
            if (!g_firstJsqSeen) {
                g_firstJsqSeen = true;
                if (!showBexlQueues('Startup')) scheduleQueueChecks('Startup delay', true);
            } else {
                showBexlQueues('Map/Update', true);
            }
        },
        onLeave: function(ret) {
            if (ret && !ret.isNull()) {
                try {
                    var itemId = readBoxDataItemId(ret);
                    var matchedBefore = matchSelectedItem(ret, itemId, this.preQueues || []);
                    var forcedReturn = maybeReplaceForcedReturn(ret, itemId, matchedBefore, this.preQueues || [], 'jsq');
                    var effectiveRet = forcedReturn ? forcedReturn.ptr : ret;
                    if (forcedReturn) {
                        itemId = forcedReturn.itemId;
                        matchedBefore = matchSelectedItem(effectiveRet, itemId, this.preQueues || []);
                    }
                    var matchedAfter = matchSelectedItem(effectiveRet, itemId);
                    g_dropCount++;
                    log('  [Drop #' + g_dropCount + '] Selected: ' + itemId);
                    log('    Pre-consume lookup: ' + describeMatchesForLog(matchedBefore.matches));
                    log('    Post-consume lookup: ' + describeMatchesForLog(matchedAfter.matches));
                    clearConsumedForcedSelection(itemId, matchedBefore.matches);
                    send({
                        type: 'selected',
                        count: g_dropCount,
                        itemId: itemId,
                        matches: matchedAfter.matches,
                        heads: matchedAfter.heads,
                        beforeMatches: matchedBefore.matches,
                        beforeHeads: matchedBefore.heads,
                        afterMatches: matchedAfter.matches,
                        afterHeads: matchedAfter.heads
                    });
                } catch(e) {}
            }
            scheduleQueueChecks('After drop', true);
        }
    });
    log('\u2713 Hooked jsq');
} else {
    log('\u26a0 jsq hook skipped; queue display and manual top still use polling/stage hooks.');
    // hookVwDropCandidates();
}

// Hook jsl
if (found['jsl']) {
    Interceptor.attach(found['jsl'], {
        onEnter: function(args) {
            if (args[0] && !args[0].isNull()) setQueueOwnerIfValid(args[0], 'jsl');
            log('\n========================================');
            log('=== Entering new map ===');
            log('========================================');
            scheduleQueueChecks('Switch map', true);
        }
    });
    log('\u2713 Hooked jsl');
}

// Hook jso
if (found['jso']) {
    Interceptor.attach(found['jso'], {
        onEnter: function(args) {
            try {
                enforceActiveForcedSelections('Before award:jso', false);
                promoteArcanaTop5('Before award:jso', false);
            } catch(e) {}
        },
        onLeave: function(ret) {
            if (ret && !ret.isNull()) {
                try {
                    var rewardItemId = readBoxDataRewardItemId(ret);
                    var forcedReward = getActiveRewardForBox(ret, rewardItemId);
                    if (forcedReward && forcedReward.itemId > 0) {
                        forceBoxRewardId(ret, forcedReward.itemId, 'jso');
                        if (forcedReward.targetPtr && !forcedReward.targetPtr.isNull() && !forcedReward.targetPtr.equals(ret)) {
                            forceBoxRewardId(forcedReward.targetPtr, forcedReward.itemId, 'jso:target');
                            ret.replace(forcedReward.targetPtr);
                            log('  [jso] Pin 01 return correction: ' + rewardItemId + ' -> ' + forcedReward.itemId + ' / ' + (forcedReward.reason || forcedReward.source || 'forced'));
                        }
                        rewardItemId = forcedReward.itemId;
                        g_pendingForcedReward = {
                            itemId: forcedReward.itemId,
                            eboxType: forcedReward.eboxType,
                            expiresAt: nowMs() + 10 * 60 * 1000,
                            source: 'jso'
                        };
                    }
                    log('  [jso] Remove BoxData: rewardItemId=' + rewardItemId);
                } catch(e) {}
            }
            scheduleQueueChecks('Open box', true);
        }
    });
    log('\u2713 Hooked jso');
}

// Hook jtg
if (found['jtg']) {
    Interceptor.attach(found['jtg'], {
        onEnter: function(args) {
            try {
                enforceActiveForcedSelections('Before award:jtg', false);
                promoteArcanaTop5('Before award:jtg', false);
                var boxPtr = args[1];
                if (!boxPtr || boxPtr.isNull()) return;
                var eboxType = args[2].toInt32();
                var rewardItemId = readBoxDataRewardItemId(boxPtr);
                var forcedReward = getActiveRewardForBox(boxPtr, rewardItemId);
                if (!forcedReward || forcedReward.itemId <= 0 || forcedReward.eboxType !== eboxType) return;
                forceBoxRewardId(boxPtr, forcedReward.itemId, 'jtg');
                if (forcedReward.targetPtr && !forcedReward.targetPtr.isNull() && !forcedReward.targetPtr.equals(boxPtr)) {
                    forceBoxRewardId(forcedReward.targetPtr, forcedReward.itemId, 'jtg:target');
                    try { args[1] = forcedReward.targetPtr; } catch(e) {}
                    log('  [jtg] ' + labelForEboxType(eboxType) + ' Pin 01 param correction: ' + rewardItemId + ' -> ' + forcedReward.itemId + ' / ' + (forcedReward.reason || forcedReward.source || 'forced'));
                }
                g_pendingForcedReward = {
                    itemId: forcedReward.itemId,
                    eboxType: forcedReward.eboxType,
                    expiresAt: nowMs() + 10 * 60 * 1000,
                    source: 'jtg'
                };
                log('  [jtg] ' + labelForEboxType(eboxType) + ' BoxData reward armed: ' + rewardItemId + ' -> ' + forcedReward.itemId);
            } catch(e) {}
        }
    });
    log('\u2713 Hooked jtg');
}

// Hook iqg
if (found['iqg']) {
    Interceptor.attach(found['iqg'], {
        onEnter: function(args) {
            g_boxOpenCount++;
        }
    });
    log('\u2713 Hooked iqg (open-box counter, silent)');
}

// Hook iql
if (found['iql']) {
    Interceptor.attach(found['iql'], {
        onEnter: function(args) {
            try {
                enforceActiveForcedSelections('Before award:iql', false);
                promoteArcanaTop5('Before award:iql', false);
                var rewardRead = readRewardItemIdForDisplay(args[0]);
                var rewardItemId = rewardRead.itemId > 0 ? rewardRead.itemId : rewardRead.raw;
                var forcedReward = null;
                if (g_pendingForcedReward) {
                    if (nowMs() > g_pendingForcedReward.expiresAt) {
                        g_pendingForcedReward = null;
                    } else {
                        var pendingItemId = parseInt(g_pendingForcedReward.itemId || '0', 10);
                        forcedReward = {
                            itemId: pendingItemId,
                            eboxType: g_pendingForcedReward.eboxType,
                            source: g_pendingForcedReward.source || 'pending'
                        };
                        if (!shouldUseAggressiveRewardFix(pendingItemId)) forcedReward = null;
                        g_pendingForcedReward = null;
                    }
                }
                if (!forcedReward) {
                    forcedReward = getActiveRewardForBox(args[0], rewardItemId);
                }
                if (forcedReward && forcedReward.itemId > 0) {
                    if (rewardItemId !== forcedReward.itemId) {
                        writeBoxDataRewardItemId(args[0], forcedReward.itemId);
                        log('  [Manual pin reward correction] rewardItemId=' + rewardItemId + ' -> ' + forcedReward.itemId + (forcedReward.matched ? ' / queue-match' : ' / pending'));
                        rewardItemId = forcedReward.itemId;
                    }
                    completeForcedSelection(forcedReward.eboxType, forcedReward.itemId, 'Reward confirmed');
                }
                if (!isPlausibleItemId(rewardItemId)) {
                    log('  [Reward] Field is not item ID: raw=' + rewardRead.raw + ' source=' + rewardRead.source + ', skip panel reward display');
                    return;
                }
                if (rewardRead.source === 'boxItemId') {
                    log('  [Reward] Field is not item ID: raw=' + rewardRead.raw + ' -> BoxData.itemId=' + rewardItemId);
                }
                log('  [Reward] rewardItemId=' + rewardItemId);
                send({ type: 'reward', itemId: rewardItemId });
            } catch(e) {}
        }
    });
    log('\u2713 Hooked iql');
}

attachSignalHook('jsp', 'vw.jsp map enter check', true);
attachSignalHook('efk', 'vw.efk map enter check', true);
attachSignalHook('el', 'vw.el map enter cache', true);
attachSignalHook('gmz', 'vw.gmz map enter cache', true);
attachSignalHook('nvm', 'vw.nvm map enter cache', true);
attachSignalHook('idd', 'vw.idd map enter cache', true);
attachSignalHook('jsm', 'vw.jsm box sync', true);
attachSignalHook('llp', 'vw.llp box sync', true);
attachSignalHook('UI_Stage.huq', 'UI_Stage.huq enter map', false);
attachSignalHook('UI_Stage.hva', 'UI_Stage.hva box count', false);
attachSignalHook('UI_Stage.hvc', 'UI_Stage.hvc box progress', false);
attachSignalHook('StageManager.ign', 'StageManager.ign get box', false);
attachSignalHook('StageBox.lgy', 'StageBox.lgy box count', false);
attachSignalHook('StageBox.lhb', 'StageBox.lhb box count', false);

setInterval(function() {
    refreshVwInstance();
    g_pollTick++;
    if (g_vw && !g_vw.isNull()) {
        showBexlQueues('Polling', false);
        if (g_pollTick % 20 === 0) send({ type: 'heartbeat', status: 'polling', vw: String(g_vw) });
    } else if (g_pollTick % 20 === 0) {
        send({ type: 'heartbeat', status: 'waiting_vw' });
    }
}, 500);

// hookStageSwitchLimitBypass();

refreshVwInstance();
waitForPanelCommands();
scheduleQueueChecks('Startup');

log('\n=== Drop Items Info v4 Ready ===');