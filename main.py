import sys
from PyQt6.QtWidgets import QApplication
from gui.main_window import TaskbarHeroToolUI

def main():
    app = QApplication(sys.argv)
    window = TaskbarHeroToolUI()
    window.show()
    sys.exit(app.exec())

if __name__ == '__main__':
    main()