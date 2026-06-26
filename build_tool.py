import os
import subprocess
import sys

def build_exe():
    print("🚀 Bắt đầu đóng gói EXE (Chế độ Cân Bằng - Giữ lại Cache)...\n")
    
    nuitka_args = [
        sys.executable, "-m", "nuitka",
        "--standalone",
        "--onefile",
        "--enable-plugin=pyqt6",
        "--windows-disable-console",
        "--output-dir=dist",
        "--assume-yes-for-downloads",
        
        # Đã gỡ bỏ cờ --remove-output để giữ lại file build giúp các lần sau build nhanh hơn
        
        "--noinclude-qt-translations",
        
        # BỘ LỌC 1: Cấm Data Science (Chống phình to 1.78GB)
        "--nofollow-import-to=numpy,pandas,matplotlib,scipy,seaborn,tkinter,IPython,jupyter,notebook",
        
        # BỘ LỌC 2: Cấm Trình duyệt Web của Qt (Giảm 150MB vô ích)
        "--nofollow-import-to=PyQt6.QtWebEngine,PyQt6.QtWebEngineCore,PyQt6.QtWebEngineWidgets",
        
        # --- ĐÓNG GÓI DỮ LIỆU ĐI KÈM ---
        "--include-data-dir=data=data",
        "--include-data-file=core/agent.js=core/agent.js",
        "--include-data-dir=resources=resources", 
        
        # --- LOGO & THÔNG TIN APP ---
        "--windows-icon-from-ico=resources/assets/logo.ico",
        "--product-name=TBH-Abyss",
        "--file-version=2.0.0",
        
        "main.py"
    ]

    try:
        subprocess.run(nuitka_args, check=True)
        print("\n" + "=" * 50)
        print("✅ [OK] HOÀN THÀNH BIÊN DỊCH!")
        print("👉 File EXE của bạn nằm tại: dist/main.exe")
        print("=" * 50)
    except subprocess.CalledProcessError as e:
        print("\n" + "=" * 50)
        print(f"❌ [LỖI] QUÁ TRÌNH BUILD THẤT BẠI (Mã lỗi: {e.returncode})")
        print("=" * 50)

if __name__ == "__main__":
    build_exe()