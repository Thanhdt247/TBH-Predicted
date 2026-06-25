// core/agent.js
'use strict';

function sendLog(msg, isError = false) {
    send({ type: isError ? 'error' : 'diag', msg: msg });
}

function sendData(normalQueues, bossQueues) {
    send({ 
        type: 'drop_data', 
        data: { "normal": normalQueues, "boss": bossQueues }
    });
}

function cR(a) { try { return a && !a.isNull() && Process.findRangeByAddress(a) !== null; } catch (e) { return false; } }
function rP(b, o) { try { var v = b.add(o).readPointer(); return cR(v) ? v : null; } catch (e) { return null; } }
function rI(b, o) { try { return b.add(o).readS32(); } catch (e) { return null; } }
function rcs2(p) { try { return p.isNull() ? null : p.readCString(); } catch (e) { return null; } }

var MOD = Process.enumerateModules().find(function (m) {
    return m.name.toLowerCase().indexOf('gameassembly') !== -1;
});

if (!MOD) {
    sendLog('Không tìm thấy GameAssembly.dll. Nhớ mở game trước nhé!', true);
} else {
    var EX = {};
    MOD.enumerateExports().forEach(function (e) { EX[e.name] = e.address; });
    
    function NF(name, ret, args) {
        if (!EX[name]) return null;
        return new NativeFunction(EX[name], ret, args);
    }

    var il2cpp_domain_get = NF('il2cpp_domain_get', 'pointer', []);
    var il2cpp_domain_get_assemblies = NF('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
    var il2cpp_assembly_get_image = NF('il2cpp_assembly_get_image', 'pointer', ['pointer']);
    var il2cpp_class_get_methods = NF('il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']);
    var il2cpp_method_is_instance = NF('il2cpp_method_is_instance', 'int', ['pointer']);
    var il2cpp_image_get_class_count = NF('il2cpp_image_get_class_count', 'int', ['pointer']);
    var il2cpp_image_get_class = NF('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    var il2cpp_class_get_fields = NF('il2cpp_class_get_fields', 'pointer', ['pointer', 'pointer']);
    var il2cpp_field_get_type = NF('il2cpp_field_get_type', 'pointer', ['pointer']);
    var il2cpp_field_get_offset = NF('il2cpp_field_get_offset', 'int', ['pointer']);
    var il2cpp_field_get_name = NF('il2cpp_field_get_name', 'pointer', ['pointer']);
    var il2cpp_type_get_name = NF('il2cpp_type_get_name', 'pointer', ['pointer']);
    var il2cpp_class_from_name = NF('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']);
    var il2cpp_method_get_name = NF('il2cpp_method_get_name', 'pointer', ['pointer']);
    var il2cpp_method_get_return_type = NF('il2cpp_method_get_return_type', 'pointer', ['pointer']);

    var K = null;
    var OFF_DICT = 0x10;
    (function () {
        var dom = il2cpp_domain_get();
        var sizePtr = Memory.alloc(Process.pointerSize);
        var asms = il2cpp_domain_get_assemblies(dom, sizePtr);
        var n = sizePtr.readU32();
        for (var a = 0; a < n && !K; a++) {
            var asm = asms.add(a * Process.pointerSize).readPointer();
            if (!asm || asm.isNull()) continue;
            var img = il2cpp_assembly_get_image(asm);
            if (!img || img.isNull()) continue;
            var cc = il2cpp_image_get_class_count(img);
            if (cc <= 0) continue;
            for (var c = 0; c < cc; c++) {
                var k = il2cpp_image_get_class(img, c);
                if (!k || k.isNull()) continue;
                var it = Memory.alloc(Process.pointerSize);
                var f, off = -1;
                while (!(f = il2cpp_class_get_fields(k, it)).isNull()) {
                    var tn = rcs2(il2cpp_type_get_name(il2cpp_field_get_type(f)));
                    if (tn && tn.indexOf('Dictionary') >= 0 && tn.indexOf('EBoxType') >= 0 &&
                        tn.indexOf('List') >= 0 && tn.indexOf('BoxData') >= 0) {
                        off = il2cpp_field_get_offset(f);
                        break;
                    }
                }
                if (off >= 0) { K = k; OFF_DICT = off; break; }
            }
        }
    })();

    if (!K) {
        sendLog('Lỗi: Không tìm thấy Class rớt đồ!', true);
    } else {
        function findClassByName(ns, name) {
            var dom = il2cpp_domain_get(); var sp = Memory.alloc(Process.pointerSize);
            var asms = il2cpp_domain_get_assemblies(dom, sp); var n = sp.readU32();
            var nsp = Memory.allocUtf8String(ns), np = Memory.allocUtf8String(name);
            for (var a = 0; a < n; a++) {
                var asm = asms.add(a * Process.pointerSize).readPointer(); if (!asm || asm.isNull()) continue;
                var img = il2cpp_assembly_get_image(asm); if (!img || img.isNull()) continue;
                var k = il2cpp_class_from_name(img, nsp, np);
                if (k && !k.isNull()) return k;
            }
            return null;
        }

        var OFF_REWARD = 0x30;
        try {
            var bd_cls = findClassByName('TaskbarHero', 'BoxData'); 
            if (bd_cls) {
                var it = Memory.alloc(Process.pointerSize); var f;
                while (!(f = il2cpp_class_get_fields(bd_cls, it)).isNull()) {
                    if (rcs2(il2cpp_field_get_name(f)) === 'o_rewardItemId') { 
                        OFF_REWARD = il2cpp_field_get_offset(f); 
                        break; 
                    }
                }
            }
        } catch(e) {}
        
        var DECRYPT = null;
        try {
            var oi = findClassByName('CodeStage.AntiCheat.ObscuredTypes', 'ObscuredInt'); 
            if (oi) {
                var it = Memory.alloc(Process.pointerSize); var mm;
                while (!(mm = il2cpp_class_get_methods(oi, it)).isNull()) {
                    if (il2cpp_method_is_instance(mm)) continue;
                    if (rcs2(il2cpp_method_get_name(mm)) !== 'op_Implicit') continue;
                    var rt = rcs2(il2cpp_type_get_name(il2cpp_method_get_return_type(mm)));
                    if (rt !== 'System.Int32' && rt !== 'Int32' && rt !== 'int') continue;
                    
                    var code = mm.readPointer();
                    if (cR(code)) { DECRYPT = new NativeFunction(code, 'int', ['pointer']); }
                    break;
                }
            }
        } catch(e) {}
        
        sendLog('Hệ Thống Quét Lõi (Sync Engine): SẴN SÀNG!');

        function readItemId(bd) {
            if (DECRYPT) { 
                try { var v = DECRYPT(bd.add(OFF_REWARD)); if (v && v > 0) return v; } catch (e) {} 
            }
            try {
                var ptr = bd.add(OFF_REWARD);
                var key = ptr.add(0).readS32();
                var hidden = ptr.add(4).readS32();
                var val = key ^ hidden;
                if (val > 0 && val < 10000000) return val;
            } catch(e) {}
            try { var raw = bd.add(OFF_REWARD).readS32(); if (raw > 0 && raw < 10000000) return raw; } catch (e) {}
            try { var p = bd.add(0x3C).readS32(); if (p > 0 && p < 10000000) return p; } catch (e) {}
            return null; 
        }

        function headerOk(vw) {
            try { return cR(vw) && vw.readPointer().equals(K); } catch (e) { return false; }
        }

        function structOk(vw) {
            if (!vw || !headerOk(vw)) return false;
            var dict = rP(vw, OFF_DICT); 
            if (!dict) return false;
            var count = rI(dict, 0x20); 
            
            // SỬA LỖI CHÍ MẠNG: Chỉ reject khi count < 0, nương tay với Rương có count = 0 (Rương Map mới)
            if (count === null || count < 0 || count > 50) return false; 
            if (count === 0) return true;
            
            var ep = rP(dict, 0x18); 
            if (!ep) return false;
            
            var total = 0;
            for (var i = 0; i < count; i++) {
                var entry = ep.add(0x20 + i * 24);
                var key = rI(entry, 0x08);
                var lp = rP(entry, 0x10);
                if (key === null || key < 0 || key > 5) return false;
                if (!lp) return false;
                
                var arr = rP(lp, 0x10);
                var sz = rI(lp, 0x18);
                if (!arr) return false;
                if (sz === null || sz < 0 || sz > 500) return false;
                total += sz;
            }
            return true;
        }

        function readQueues(vw) {
            if (!structOk(vw)) return null; 
            var dict = rP(vw, OFF_DICT);
            var count = rI(dict, 0x20);
            
            if (count === 0) return { n: [], b: [] }; // Nhả mảng rỗng nếu là Rương trống

            var ep = rP(dict, 0x18);
            var n_arr = [];
            var b_arr = [];
            
            for (var i = 0; i < count; i++) {
                var entry = ep.add(0x20 + i * 24);
                var key = rI(entry, 0x08);
                var lp = rP(entry, 0x10);
                var arr = rP(lp, 0x10);
                var sz = rI(lp, 0x18);
                
                for (var j = 0; j < Math.min(sz, 64); j++) {
                    var bd = rP(arr, 0x20 + j * 8);
                    if (!bd) continue;
                    var id = readItemId(bd);
                    if (id !== null && id > 0) {
                        if (key === 0) n_arr.push(id);
                        if (key === 1) b_arr.push(id);
                    }
                }
            }
            return { n: n_arr, b: b_arr };
        }

        var PAT = (function () {
            var hx = K.toString(16); while (hx.length < 16) hx = '0' + hx;
            var bb = []; for (var i = 0; i < 8; i++) bb.push(hx.substr((7 - i) * 2, 2));
            return bb.join(' ');
        })();

        // ========================================================
        // 🚀 ĐỘNG CƠ QUÉT ĐỒNG BỘ TIME-SLICING - CHỐNG TREO 100%
        // ========================================================
        var chest_history = {}; 
        var current_active_chest = null;
        var last_sent_key = "";
        var g_scanning = false;

        function doFullScan() {
            if (g_scanning) return;
            g_scanning = true;

            var ranges = Process.enumerateRanges('rw-');
            var r = 0;
            var found = [];

            function scanTick() {
                var start = Date.now();
                while (r < ranges.length) {
                    var range = ranges[r++];
                    
                    // Lọc bỏ vùng nhớ rác
                    if (range.size < 4096 || range.size > 1024 * 1024 * 200) continue; 
                    
                    try {
                        // TUYỆT KỸ SCAN-SYNC: Quét từng cục bộ nhớ. Lỗi thì skip. Không xài Call-back, tránh đứng máy!
                        var hits = Memory.scanSync(range.base, range.size, PAT);
                        for (var i = 0; i < hits.length; i++) {
                            var addr = hits[i].address;
                            if (headerOk(addr) && structOk(addr)) {
                                found.push(addr);
                            }
                        }
                    } catch (e) { }
                    
                    // NGHỆ THUẬT CẮT LÁT THỜI GIAN:
                    // Quét > 40ms là phải nhả luồng CPU ra cho game chạy 10ms rồi quét tiếp, chống giật game!
                    if (Date.now() - start > 40) {
                        setTimeout(scanTick, 10);
                        return;
                    }
                }
                
                // Kết thúc 1 đợt quét toàn RAM
                processScanResults(found);
                g_scanning = false;
                
                // Dùng vệ tinh quét định kỳ 1.5 giây / 1 lần
                setTimeout(doFullScan, 1500); 
            }
            
            scanTick();
        }

        function processScanResults(found) {
            var valid_addrs = new Set();
            var changed_chest = null;
            var best_chest = null;
            var highest = -1;

            for (var i = 0; i < found.length; i++) {
                var addr = found[i];
                var addrStr = addr.toString();
                valid_addrs.add(addrStr);

                var qs = readQueues(addr);
                if (!qs) continue;

                var total = qs.n.length + qs.b.length;
                var key = qs.n.length + "-" + qs.b.length;

                // Nếu có biến động đồ đạc, khoanh vùng ngay rương đó
                if (chest_history[addrStr] === undefined) {
                    chest_history[addrStr] = key;
                    if (total > 0) changed_chest = addr;
                } else {
                    if (chest_history[addrStr] !== key) {
                        chest_history[addrStr] = key;
                        changed_chest = addr; 
                    }
                }

                // Luôn cập nhật rương mập nhất để dự phòng
                if (total > highest) {
                    highest = total;
                    best_chest = addr;
                }
            }

            // Gạch tên mấy cái rương Bóng ma bị game xóa
            for (var oldAddr in chest_history) {
                if (!valid_addrs.has(oldAddr)) {
                    delete chest_history[oldAddr];
                }
            }

            var target_chest = changed_chest ? changed_chest : best_chest;

            if (target_chest) {
                var targetStr = target_chest.toString();
                if (current_active_chest !== targetStr) {
                    current_active_chest = targetStr;
                    
                    // RA LỆNH CHO PYTHON DỌN DẸP UI
                    send({ type: 'new_chest_locked' });
                    last_sent_key = ""; // Reset khóa gửi để cập nhật ngay lập tức
                    sendLog("Khóa mục tiêu Rương Map mới: " + targetStr);
                }
            }
        }

        doFullScan(); // Kích hoạt tên lửa quét

        // ========================================================
        // 🚀 BƠM DỮ LIỆU LÊN GIAO DIỆN MỖI 0.3 GIÂY
        // ========================================================
        setInterval(function () {
            if (!current_active_chest) return;

            var addr = ptr(current_active_chest);
            if (!structOk(addr)) return; 
            
            var qs = readQueues(addr);
            if (!qs) return;
            
            var current_key = qs.n.length + "-" + qs.b.length;
            
            if (current_key !== last_sent_key) {
                last_sent_key = current_key;
                sendData(qs.n, qs.b);
            }
        }, 300); 
    }
}