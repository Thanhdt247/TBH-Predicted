# data/database.py
import csv
import json
import os

ITEM_DB = {}

# CẤU HÌNH ĐA NGÔN NGỮ (Tự động map mã giao diện với tên file)
SUPPORTED_LANGS = {"vi": "vi-VN", "en": "en-US"} 

RARITY_COLORS = {
    "COMMON": "#9E9E9E", "UNCOMMON": "#4CAF50", "RARE": "#317BB7",        
    "LEGENDARY": "#FF9800", "IMMORTAL": "#DF1717", "ARCANA": "#E87BD8",
    "BEYOND": "#C937BD", "CELESTIAL": "#75DAE1", "DIVINE": "#E57373",      
    "COSMIC": "#9167D8", "UNKNOWN": "#FFFFFF"
}

NUMERIC_RARITY = [
    "COMMON", "UNCOMMON", "RARE", "LEGENDARY", "IMMORTAL", 
    "ARCANA", "BEYOND", "CELESTIAL", "DIVINE", "COSMIC"
]

# ĐƯỜNG DẪN FILE CACHE SIÊU TỐC
CACHE_FILE = os.path.join(os.path.dirname(__file__), "item_cache.json")

def get_search_dirs():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(base_dir)
    return [base_dir, os.path.join(project_dir, "resources")]

def find_file_deep(filename):
    for d in get_search_dirs():
        if not os.path.exists(d): continue
        for root, _, files in os.walk(d):
            if filename in files:
                return os.path.join(root, filename)
    return None

def extract_unity_table(data):
    if isinstance(data, dict):
        if "m_TableData" in data: return data["m_TableData"]
        if "m_Entries" in data: return data["m_Entries"]
        for v in data.values():
            res = extract_unity_table(v)
            if res: return res
    elif isinstance(data, list):
        if len(data) > 0 and isinstance(data[0], dict) and ("m_Id" in data[0] or "m_Key" in data[0]):
            return data
        for item in data:
            res = extract_unity_table(item)
            if res: return res
    return []

def load_database():
    global ITEM_DB
    
    # ========================================================
    # 1. CƠ CHẾ CACHING: ĐỌC DỮ LIỆU SIÊU TỐC TỪ Ổ CỨNG
    # ========================================================
    if os.path.exists(CACHE_FILE):
        try:
            print("⚡ Đang nạp Database từ Cache siêu tốc...")
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                ITEM_DB.update(json.load(f))
            print(f"✔️ Bật Tool trong tích tắc! Đã nạp {len(ITEM_DB)} ID.\n")
            return 
        except Exception as e:
            print("⚠️ Lỗi đọc file Cache, sẽ tiến hành quét lại từ đầu...")

    # ========================================================
    # 2. QUÉT RAW DATA (Chỉ chạy khi không có Cache)
    # ========================================================
    ITEM_DB.clear() 
    
    print(f"\n{'='*50}\n🚀 ĐANG KHỞI ĐỘNG HỆ THỐNG ĐA NGÔN NGỮ (VI/EN)\n{'='*50}")
    
    key_to_id = {}
    id_to_localized = {"vi": {}, "en": {}}
    
    # NẠP CẦU NỐI
    bridge_files = ["ItemTable.json", "ItemTable.txt", "StringTable.json", "StringTable.txt"]
    for bf in bridge_files:
        path = find_file_deep(bf)
        if path:
            try:
                with open(path, "r", encoding="utf-8-sig") as f:
                    for entry in extract_unity_table(json.load(f)):
                        k, i = entry.get("m_Key") or entry.get("Key"), entry.get("m_Id")
                        if k and i: key_to_id[str(k).strip()] = str(i).strip()
            except: pass

    # NẠP TỪ ĐIỂN DỊCH
    for short_lang, full_lang in SUPPORTED_LANGS.items():
        lang_alt = full_lang.replace("-", "_")
        lang_files = [
            f"ItemTable_{full_lang}.json", f"ItemTable_{full_lang}.txt", 
            f"ItemTable_{lang_alt}.json", f"ItemTable_{lang_alt}.txt",
            f"StringTable_{full_lang}.json", f"StringTable_{full_lang}.txt", 
            f"StringTable_{lang_alt}.json", f"StringTable_{lang_alt}.txt"
        ]
        
        loaded_count = 0
        for lf in lang_files:
            path = find_file_deep(lf)
            if path:
                try:
                    with open(path, "r", encoding="utf-8-sig") as f:
                        for entry in extract_unity_table(json.load(f)):
                            i, l = entry.get("m_Id"), entry.get("m_Localized")
                            if i and l: 
                                id_to_localized[short_lang][str(i).strip()] = str(l).strip()
                                loaded_count += 1
                except: pass
        print(f"✔️ Nạp thành công {loaded_count} câu dịch cho ngôn ngữ: {full_lang}")

    # QUÉT DATA
    total_loaded = 0
    all_data_files = []
    
    for d in get_search_dirs():
        if not os.path.exists(d): continue
        for root, _, files in os.walk(d):
            for f in files:
                if (f.endswith(".txt") or f.endswith(".csv")) and "Table" not in f:
                    all_data_files.append(os.path.join(root, f))
                    
    for path in all_data_files:
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                first_line = f.readline()
                f.seek(0)
                reader = csv.DictReader(f, delimiter='\t' if '\t' in first_line else ',')
                
                for row in reader:
                    item_id = str(row.get("ItemKey") or row.get("MaterialKey") or row.get("Id") or row.get("CurrencyKey") or list(row.values())[0]).strip()
                    if not item_id or not item_id.isdigit(): continue
                    
                    name_key = str(row.get("NameKey", "")).strip()
                    
                    final_names = {
                        "vi": name_key if name_key else f"Vật phẩm lạ ({item_id})",
                        "en": name_key if name_key else f"Unknown Item ({item_id})"
                    }
                    
                    guess_keys = [
                        name_key, f"ItemName_{item_id}", f"MaterialName_{item_id}",
                        f"CurrencyName_{item_id}", f"ClassCardName_{item_id}", item_id
                    ]
                    
                    for k in guess_keys:
                        if k in key_to_id:
                            hash_id = key_to_id[k]
                            for short_lang in SUPPORTED_LANGS:
                                if hash_id in id_to_localized[short_lang]:
                                    final_names[short_lang] = id_to_localized[short_lang][hash_id]
                            break 
                    
                    for short_lang in SUPPORTED_LANGS:
                        if final_names[short_lang].startswith("ItemName_") or final_names[short_lang].startswith("MaterialName_"):
                            final_names[short_lang] = f"Vật phẩm {item_id}" if short_lang == "vi" else f"Item {item_id}"
                        
                    raw_rarity = str(row.get("GRADE") or row.get("Grade") or row.get("Rarity") or row.get("Quality") or row.get("Tier") or "COMMON").strip().upper()
                    
                    if raw_rarity.isdigit():
                        idx = int(raw_rarity)
                        rarity = NUMERIC_RARITY[idx] if 0 <= idx < len(NUMERIC_RARITY) else "COMMON"
                    else:
                        rarity = raw_rarity
                    
                    if item_id not in ITEM_DB:
                        ITEM_DB[item_id] = {"name": final_names, "rarity": rarity}
                    else:
                        for short_lang in SUPPORTED_LANGS:
                            if not final_names[short_lang].startswith("Vật phẩm") and not final_names[short_lang].startswith("Item") and not final_names[short_lang].startswith("Unknown"):
                                ITEM_DB[item_id]["name"][short_lang] = final_names[short_lang]
                            
                        if rarity != "COMMON" and rarity != "UNKNOWN":
                            ITEM_DB[item_id]["rarity"] = rarity
                            
                    total_loaded += 1
        except: pass

    print(f"{'='*50}\n🚀 HOÀN THÀNH: Đã gắn tên Đa Ngôn Ngữ cho {len(ITEM_DB)} ID độc lập!\n{'='*50}\n")

    # ========================================================
    # 3. LƯU BẢN SAO VÀO CACHE ĐỂ LẦN SAU KHỞI ĐỘNG NHANH
    # ========================================================
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(ITEM_DB, f, ensure_ascii=False, separators=(',', ':'))
        print(f"💾 Đã đóng gói và lưu Cache tại: {CACHE_FILE}\n")
    except Exception as e:
        print(f"⚠️ Không thể lưu file Cache: {e}")

# Tự động nạp dữ liệu khi bật Tool
load_database()

def get_item_info(item_id, lang="vi", **kwargs):
    """Hàm xuất dữ liệu động: Sẽ tự động nhả tên theo Ngôn Ngữ"""
    item_id = str(item_id).strip()
    if not lang: lang = "vi"
    
    if item_id not in ITEM_DB:
        fallback = f"Chưa rõ ({item_id})" if lang == "vi" else f"Unknown ({item_id})"
        return {"name": fallback, "rarity": "UNKNOWN", "color": RARITY_COLORS["UNKNOWN"]}
        
    info = ITEM_DB[item_id]
    name = info["name"].get(lang, info["name"].get("vi"))
    
    return {
        "name": name, 
        "rarity": info["rarity"], 
        "color": RARITY_COLORS.get(info["rarity"], RARITY_COLORS["UNKNOWN"])
    }

def get_all_item_ids():
    """
    TRỌNG TÂM: Hàm này cung cấp toàn bộ ID cho Tab Data bên main_window.py
    Thiếu nó là App sẽ vỡ giao diện!
    """
    ids = list(ITEM_DB.keys())
    try:
        # Sắp xếp số nguyên tăng dần cho đẹp mắt
        return sorted(ids, key=lambda x: int(x) if x.isdigit() else x)
    except:
        return sorted(ids)