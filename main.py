import sys
import os
import shutil
import tempfile
from PyQt6.QtWidgets import QApplication
from gui.main_window import TaskbarHeroToolUI

def clean_frida_temp_garbage():
    """Hàm dọn dẹp các thư mục rác 50MB của Frida bị kẹt trong ổ C"""
    temp_dir = tempfile.gettempdir()
    for item in os.listdir(temp_dir):
        if item.startswith("frida-"):
            path = os.path.join(temp_dir, item)
            try:
                shutil.rmtree(path)
            except Exception:
                pass # Bỏ qua nếu file đang bị game sử dụng

def main():
    # Dọn rác trước khi khởi động
    clean_frida_temp_garbage()
    
    app = QApplication(sys.argv)
    window = TaskbarHeroToolUI()
    window.show()
    sys.exit(app.exec())

if __name__ == '__main__':
    main()