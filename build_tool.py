import os
import shutil
import subprocess
import sys

def clean_old_builds():
    """Dọn dẹp các thư mục rác từ những lần build trước"""
    print("🧹 Đang dọn dẹp các bản build cũ...")
    folders_to_clean = ['dist', 'main.build', 'main.dist', 'main.onefile-build']
    
    for folder in folders_to_clean:
        if os.path.exists(folder):
            try:
                shutil.rmtree(folder)
                print(f"  [+] Đã xóa dọn: {folder}/")
            except Exception as e:
                print(f"  [-] Lỗi khi xóa {folder}: {e}")
    print("-" * 50)

def build_exe():
    """Khởi chạy Nuitka với cấu hình tối ưu cho PyQt6 và Frida"""
    print("🚀 Bắt đầu đóng gói EXE bằng Nuitka...\n")
    
    # Danh sách các tham số Nuitka
    nuitka_args = [
        sys.executable, "-m", "nuitka",
        "--standalone",                      # Tạo thư mục độc lập chứa mọi DLL
        "--onefile",                         # Gom tất cả vào 1 file .exe duy nhất
        "--enable-plugin=pyqt6",             # Kích hoạt hỗ trợ PyQt6
        "--windows-disable-console",         # Ẩn cửa sổ dòng lệnh đen (CMD) khi chạy App
        "--output-dir=dist",                 # Thư mục xuất file
        "--assume-yes-for-downloads",        # Tự động tải compiler nếu thiếu
        
        # --- ĐÓNG GÓI DỮ LIỆU ĐI KÈM ---
        "--include-data-dir=data=data",      # Bê nguyên thư mục data vào (quan trọng)
        "--include-data-file=core/agent.js=core/agent.js", # Bắt buộc phải có file tiêm Frida
        
        # (Bỏ dấu # ở 2 dòng dưới nếu project của bạn có thư mục config và resources)
        # "--include-data-dir=config=config",
        # "--include-data-dir=resources=resources",
        
        # --- THÔNG TIN APP ---
        "--product-name=TaskbarHero Drop Tool",
        "--file-version=2.0.0",
        
        # File gốc cần build
        "main.py"
    ]

    try:
        # Chạy lệnh build và hiển thị output trực tiếp ra màn hình
        subprocess.run(nuitka_args, check=True)
        print("\n" + "=" * 50)
        print("✅ ĐÓNG GÓI THÀNH CÔNG! File EXE nằm trong thư mục 'dist/'")
        print("=" * 50)
    except subprocess.CalledProcessError as e:
        print("\n" + "=" * 50)
        print(f"❌ QUÁ TRÌNH BUILD THẤT BẠI: Cú pháp Nuitka bị lỗi (Mã lỗi: {e.returncode})")
        print("=" * 50)
    except FileNotFoundError:
        print("\n❌ Không tìm thấy Nuitka! Hãy mở terminal và chạy lệnh: pip install nuitka")

if __name__ == "__main__":
    clean_old_builds()
    build_exe()