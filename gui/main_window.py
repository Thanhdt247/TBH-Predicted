# gui/main_window.py
import threading
import re
import os
from datetime import datetime

from PyQt6.QtCore import Qt, pyqtSignal, QAbstractTableModel, QModelIndex, QSortFilterProxyModel
from PyQt6.QtGui import QFont, QColor, QIcon
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QTableWidgetItem, 
                             QHeaderView, QLabel, QFrame)

from qfluentwidgets import (FluentWindow, NavigationItemPosition, FluentIcon as FIF,
                            SubtitleLabel, TableWidget, TableView, ComboBox,
                            InfoBar, InfoBarPosition, ScrollArea, SettingCardGroup,
                            RangeSettingCard, SwitchSettingCard, LineEdit, SearchLineEdit,
                            PrimaryPushButton, PushButton, TextEdit, setTheme, Theme)

from config.settings import PROCESS_NAME, CURRENT_VERSION, cfg, qconfig
from data.database import get_item_info
from core.frida_manager import FridaManager

try:
    from data.database import get_all_item_ids
except ImportError:
    def get_all_item_ids():
        return ["117001", "127001"] 

UI_TEXT = {
    "vi": {
        "console_title": "Console & Điều Khiển",
        "btn_start": "BẬT TOOL",
        "btn_stop": "TẮT TOOL",
        "lang_label": "Ngôn ngữ hiển thị:",
        "drop_title": "Danh sách Vật phẩm Tiên tri",
        "tracked_box": "Đang theo dõi",  
        "normal_box": "Rương thường",
        "boss_box": "Rương boss",
        "headers_drop": ["#", "ID", "Hiếm", "Tên"],     
        "headers_track": ["ID", "Hiếm", "Tên"],         
        "setting_title": "Cài đặt hệ thống",
        "setting_ui_group": "Giao diện & Hiển thị",
        "setting_font": "Kích thước chữ",
        "setting_font_desc": "Tuỳ chỉnh độ lớn chữ",
        "setting_filter_group": "Radar & Bộ lọc (Ẩn đồ chờ rớt)",
        "hide": "Ẩn đồ",
        "hide_desc": "Loại bỏ đồ màu",
        "setting_adv_group": "Tính năng Can thiệp (Hack Lõi)",
        "adv_bypass": "Xóa thời gian chờ đổi Map",
        "adv_bypass_desc": "Bypass Limit: Bỏ qua cảnh báo thao tác quá nhanh của Game",
        "adv_coin": "Ép Tiền Kỷ Niệm lên đầu Rương",
        "adv_coin_desc": "Auto Coin: Ưu tiên nhả các loại vé quay, tiền VIP ra trước",
        "adv_arcana": "Ép đồ Arcana vào Top 5",
        "adv_arcana_desc": "Auto Arcana: Ưu tiên rớt trang bị/nguyên liệu Arcana lên đầu",
        "log_ready": "Hệ thống đã sẵn sàng. Chờ lệnh khởi động...",
        "log_detach": "Đang rút mã tiêm, ngắt kết nối...",
        "log_search": "Đang tìm tiến trình",
        "toast_success": "Thành công",
        "toast_error": "Lỗi",
        "nav_console": "Điều Khiển",
        "nav_drop": "Rương Drop",
        "nav_setting": "Cài Đặt",
        "found": "Đã tìm thấy",
        "normal_count": "rương thường",
        "boss_count": "rương boss",
        "empty_warning": "Tìm thấy rương nhưng ID rỗng. Cần kiểm tra hàm giải mã.",
        "claimed": "Đã nhận:",
        "wishlist_ph": "Nhập nhiều ID (cách nhau bằng dấu phẩy)...",
        "wishlist_add": "Thêm",
        "wishlist_clear": "Xóa",
        "alert_title": "PHÁT HIỆN MỤC TIÊU!",
        "alert_desc": "Vật phẩm đang theo dõi vừa xuất hiện. Nhặt ngay!",
        "nav_data": "Từ Điển",
        "data_title": "Thư viện Vật phẩm",
        "search_ph": "Nhập ID hoặc Tên vật phẩm để tìm...",
        "col_name": "Tên Vật Phẩm",
        "col_action": "Hành Động"
    },
    "en": {
        "console_title": "Console & Control",
        "btn_start": "START TOOL",
        "btn_stop": "STOP TOOL",
        "lang_label": "Display Language:",
        "drop_title": "Predicted Drop List",
        "tracked_box": "Tracking",
        "normal_box": "Normal Box",
        "boss_box": "Boss Box",
        "headers_drop": ["#", "ID", "Rarity", "Name"],
        "headers_track": ["ID", "Rarity", "Name"],
        "setting_title": "System Settings",
        "setting_ui_group": "UI & Display",
        "setting_font": "Font Size",
        "setting_font_desc": "Adjust font size globally",
        "setting_filter_group": "Radar & Filters (Hide pending)",
        "hide": "Hide",
        "hide_desc": "Filter out",
        "setting_adv_group": "Advanced Features (Hack)",
        "adv_bypass": "Bypass Map Cooldown",
        "adv_bypass_desc": "Remove the wait time and warnings when switching maps.",
        "adv_coin": "Promote Important Coins",
        "adv_coin_desc": "Force Event Coins and Gacha Tickets to drop first.",
        "adv_arcana": "Promote Arcana to Top 5",
        "adv_arcana_desc": "Force Arcana gears and materials into the first 5 drop slots.",
        "log_ready": "System ready. Waiting for start command...",
        "log_detach": "Detaching payload, disconnecting...",
        "log_search": "Searching for process",
        "toast_success": "Success",
        "toast_error": "Error",
        "nav_console": "Control",
        "nav_drop": "Drops",
        "nav_setting": "Settings",
        "found": "Found",
        "normal_count": "normal boxes",
        "boss_count": "boss boxes",
        "empty_warning": "Boxes found but ID is empty. Check decryption function.",
        "claimed": "Claimed:",
        "wishlist_ph": "Enter multiple IDs (comma separated)...",
        "wishlist_add": "Add",
        "wishlist_clear": "Clear",
        "alert_title": "TARGET DETECTED!",
        "alert_desc": "Tracked item has appeared. Loot it now!",
        "nav_data": "Database",
        "data_title": "Item Library",
        "search_ph": "Search by ID or Item Name...",
        "col_name": "Item Name",
        "col_action": "Action"
    }
}

class ConsoleInterface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent=parent)
        self.setObjectName("ConsoleInterface")
        self.vBoxLayout = QVBoxLayout(self)
        self.vBoxLayout.setContentsMargins(20, 20, 20, 20)
        self.titleLabel = SubtitleLabel(UI_TEXT["vi"]["console_title"], self)
        self.vBoxLayout.addWidget(self.titleLabel)
        self.controlLayout = QHBoxLayout()
        self.btnToggle = PrimaryPushButton(FIF.PLAY, UI_TEXT["vi"]["btn_start"])
        self.btnToggle.setFixedWidth(150)
        self.controlLayout.addWidget(self.btnToggle)
        self.controlLayout.addStretch(1)
        self.vBoxLayout.addLayout(self.controlLayout)
        self.logArea = TextEdit(self)
        self.logArea.setReadOnly(True)
        self.logArea.setFont(QFont("Consolas", 10)) 
        self.vBoxLayout.addWidget(self.logArea)

    def print_log(self, text, color="#E0E0E0", is_bold=False):
        time_str = datetime.now().strftime("%H:%M:%S")
        weight = "bold" if is_bold else "normal"
        html = f'<span style="color: #888888">[{time_str}]</span> <span style="color: {color}; font-weight: {weight}">{text}</span>'
        self.logArea.append(html)

    def update_texts(self, lang_code, is_running):
        t = UI_TEXT[lang_code]
        self.titleLabel.setText(t["console_title"])
        self.btnToggle.setText(t["btn_stop"] if is_running else t["btn_start"])

class DropInterface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent=parent)
        self.setObjectName("DropInterface")
        self.vBoxLayout = QVBoxLayout(self)
        self.vBoxLayout.setContentsMargins(15, 15, 15, 15)
        self.vBoxLayout.setSpacing(10)
        self.wishlistLayout = QHBoxLayout()
        self.lblTrack = QLabel(UI_TEXT["vi"]["tracked_box"], self)
        self.lblTrack.setStyleSheet("font-weight: bold; font-size: 14px; color: #E0E0E0;")
        self.wishlistInput = LineEdit(self)
        self.wishlistInput.setPlaceholderText(UI_TEXT["vi"]["wishlist_ph"])
        self.btnAddWishlist = PushButton(FIF.ADD, UI_TEXT["vi"]["wishlist_add"], self)
        self.btnClearWishlist = PushButton(FIF.DELETE, UI_TEXT["vi"]["wishlist_clear"], self)
        self.wishlistLayout.addWidget(self.lblTrack)
        self.wishlistLayout.addWidget(self.wishlistInput, 1)
        self.wishlistLayout.addWidget(self.btnAddWishlist)
        self.wishlistLayout.addWidget(self.btnClearWishlist)
        self.vBoxLayout.addLayout(self.wishlistLayout)
        self.table_tracked = self.create_table(UI_TEXT["vi"]["headers_track"], is_track_table=True)
        self.vBoxLayout.addWidget(self.table_tracked, 1) 
        self.tablesLayout = QHBoxLayout()
        self.tablesLayout.setSpacing(10) 
        self.normal_layout = QVBoxLayout()
        self.normalLabel = QLabel(UI_TEXT["vi"]["normal_box"], self)
        self.normalLabel.setStyleSheet("font-weight: bold; font-size: 14px; color: #E0E0E0;")
        self.table_normal = self.create_table(UI_TEXT["vi"]["headers_drop"])
        self.normal_layout.addWidget(self.normalLabel)
        self.normal_layout.addWidget(self.table_normal)
        self.boss_layout = QVBoxLayout()
        self.bossLabel = QLabel(UI_TEXT["vi"]["boss_box"], self)
        self.bossLabel.setStyleSheet("font-weight: bold; font-size: 14px; color: #E0E0E0;")
        self.table_boss = self.create_table(UI_TEXT["vi"]["headers_drop"])
        self.boss_layout.addWidget(self.bossLabel)
        self.boss_layout.addWidget(self.table_boss)
        self.tablesLayout.addLayout(self.normal_layout)
        self.tablesLayout.addLayout(self.boss_layout)
        self.vBoxLayout.addLayout(self.tablesLayout, 2) 

    def create_table(self, headers, is_track_table=False):
        table = TableWidget(self)
        table.setColumnCount(len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.setWordWrap(False) 
        table.setTextElideMode(Qt.TextElideMode.ElideRight)
        table.setShowGrid(False) 
        table.setStyleSheet("""
            QTableView { background-color: #121212; border: 1px solid #333333; color: #E0E0E0; outline: none; }
            QHeaderView::section { background-color: #1A1A1A; color: #B0B0B0; font-weight: bold; border: none; border-bottom: 2px solid #2D2D2D; padding: 4px; }
            QTableView::item { border: none; border-bottom: 1px solid #1E1E1E; }
            QTableView::item:selected { background-color: #2A2A2A; }
            QTableCornerButton::section { background-color: #1A1A1A; border: none; }
        """)
        if is_track_table:
            table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents) 
            table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents) 
            table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch) 
        else:
            table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents) 
            table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents) 
            table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents) 
            table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch) 
        table.verticalHeader().hide()
        table.verticalHeader().setDefaultSectionSize(26) 
        return table

    def update_texts(self, lang_code, tracked_items):
        t = UI_TEXT[lang_code]
        self.lblTrack.setText(t["tracked_box"])
        self.normalLabel.setText(t["normal_box"])
        self.bossLabel.setText(t["boss_box"])
        self.table_tracked.setHorizontalHeaderLabels(t["headers_track"])
        self.table_normal.setHorizontalHeaderLabels(t["headers_drop"])
        self.table_boss.setHorizontalHeaderLabels(t["headers_drop"])
        self.wishlistInput.setPlaceholderText(t["wishlist_ph"])
        self.btnAddWishlist.setText(t["wishlist_add"])
        self.btnClearWishlist.setText(t["wishlist_clear"])

class ItemTableModel(QAbstractTableModel):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.ids = []
        self.lang_code = "vi"
        self.tracked_items = set()
        self.headers = ["ID", "Tên Vật Phẩm", "Hành Động"]
        self.font_bold = QFont("Segoe UI", 10)
        self.font_bold.setBold(True)

    def set_data(self, ids, lang_code, tracked_items):
        self.beginResetModel()
        self.ids = ids
        self.lang_code = lang_code
        self.tracked_items = tracked_items
        self.endResetModel()

    def update_lang(self, lang_code, new_headers):
        self.lang_code = lang_code
        self.headers = new_headers
        self.headerDataChanged.emit(Qt.Orientation.Horizontal, 0, 2)
        self.dataChanged.emit(self.index(0, 1), self.index(self.rowCount()-1, 1))

    def update_tracked(self, tracked_items):
        self.tracked_items = tracked_items
        self.dataChanged.emit(self.index(0, 2), self.index(self.rowCount()-1, 2))

    def rowCount(self, parent=QModelIndex()):
        return len(self.ids)

    def columnCount(self, parent=QModelIndex()):
        return 3

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid(): return None
        row, col = index.row(), index.column()
        item_id = str(self.ids[row])
        if role == Qt.ItemDataRole.DisplayRole:
            if col == 0: return item_id
            elif col == 1: return get_item_info(item_id, lang=self.lang_code)["name"]
            elif col == 2: return "[✅]" if item_id in self.tracked_items else "[+]"
        elif role == Qt.ItemDataRole.ForegroundRole:
            if col == 1: return QColor(get_item_info(item_id, lang=self.lang_code)["color"])
            elif col == 2: return QColor("#4CAF50") if item_id in self.tracked_items else QColor("#9E9E9E")
        elif role == Qt.ItemDataRole.FontRole:
            if col == 1 or col == 2: return self.font_bold
        elif role == Qt.ItemDataRole.TextAlignmentRole:
            if col == 0 or col == 2: return Qt.AlignmentFlag.AlignCenter
            return Qt.AlignmentFlag.AlignVCenter
        elif role == Qt.ItemDataRole.UserRole: 
            return item_id 
        return None

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            return self.headers[section]
        return None

class ItemFilterProxyModel(QSortFilterProxyModel):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.filter_text = ""
        
    def set_filter_text(self, text):
        self.filter_text = text.lower()
        self.invalidateFilter() 
        
    def filterAcceptsRow(self, source_row, source_parent):
        if not self.filter_text: return True
        model = self.sourceModel()
        item_id = str(model.ids[source_row])
        name = get_item_info(item_id, lang=model.lang_code)["name"].lower()
        return (self.filter_text in item_id) or (self.filter_text in name)

class DataInterface(QWidget):
    signal_toggle_track = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent=parent)
        self.setObjectName("DataInterface")
        self.vBoxLayout = QVBoxLayout(self)
        self.vBoxLayout.setContentsMargins(20, 20, 20, 20)
        self.titleLabel = SubtitleLabel(UI_TEXT["vi"]["data_title"], self)
        self.searchBar = SearchLineEdit(self)
        self.searchBar.setPlaceholderText(UI_TEXT["vi"]["search_ph"])
        self.table = TableView(self)
        self.model = ItemTableModel(self)
        self.proxy_model = ItemFilterProxyModel(self)
        self.proxy_model.setSourceModel(self.model)
        self.table.setModel(self.proxy_model)
        self.searchBar.textChanged.connect(self.proxy_model.set_filter_text)
        self.table.clicked.connect(self.on_table_clicked)
        self.table.setStyleSheet("""
            QTableView { background-color: #121212; border: 1px solid #333333; color: #E0E0E0; outline: none; }
            QHeaderView::section { background-color: #1A1A1A; color: #B0B0B0; font-weight: bold; border: none; border-bottom: 2px solid #2D2D2D; padding: 4px; }
            QTableView::item { border-bottom: 1px solid #1E1E1E; }
            QTableView::item:selected { background-color: #2A2A2A; }
        """)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.table.verticalHeader().hide()
        self.table.verticalHeader().setDefaultSectionSize(32)
        self.vBoxLayout.addWidget(self.titleLabel)
        self.vBoxLayout.addWidget(self.searchBar)
        self.vBoxLayout.addWidget(self.table)

    def on_table_clicked(self, index):
        if index.column() == 2:
            item_id = self.proxy_model.data(index, Qt.ItemDataRole.UserRole)
            if item_id:
                self.signal_toggle_track.emit(item_id)

    def start_loading(self, lang_code, tracked_items):
        if not self.model.ids:
            all_ids = get_all_item_ids()
            self.model.set_data(all_ids, lang_code, tracked_items)

    def update_texts(self, lang_code):
        t = UI_TEXT[lang_code]
        self.titleLabel.setText(t["data_title"])
        self.searchBar.setPlaceholderText(t["search_ph"])
        new_headers = ["ID", t["col_name"], t["col_action"]]
        self.model.update_lang(lang_code, new_headers)

    def update_tracking_status(self, tracked_items):
        self.model.update_tracked(tracked_items)

class SettingInterface(ScrollArea):
    def __init__(self, parent=None):
        super().__init__(parent=parent)
        self.setObjectName("SettingInterface")
        self.setWidgetResizable(True)
        self.scrollWidget = QWidget()
        self.scrollWidget.setObjectName("scrollWidget")
        self.setStyleSheet("""
            QScrollArea { background-color: #202020; border: none; }
            #scrollWidget { background-color: #202020; }
        """)
        self.viewport().setStyleSheet("background-color: transparent;")
        
        self.setWidget(self.scrollWidget)
        self.vBoxLayout = QVBoxLayout(self.scrollWidget)
        self.vBoxLayout.setContentsMargins(30, 20, 30, 20)

        self.titleLabel = SubtitleLabel(UI_TEXT["vi"]["setting_title"], self)
        self.vBoxLayout.addWidget(self.titleLabel)

        self.langLayout = QHBoxLayout()
        self.langLabel = QLabel(UI_TEXT["vi"]["lang_label"], self.scrollWidget)
        self.langLabel.setStyleSheet("font-weight: bold; font-size: 14px; color: #E0E0E0;")
        self.comboLang = ComboBox(self.scrollWidget)
        self.comboLang.addItems(["Tiếng Việt", "English"])
        self.comboLang.setCurrentText(cfg.language.value)
        self.langLayout.addWidget(self.langLabel)
        self.langLayout.addWidget(self.comboLang)
        self.langLayout.addStretch(1)
        self.vBoxLayout.addLayout(self.langLayout)
        self.vBoxLayout.addSpacing(20)

        self.displayGroup = SettingCardGroup(UI_TEXT["vi"]["setting_ui_group"], self.scrollWidget)
        self.fontCard = RangeSettingCard(cfg.font_size, FIF.FONT, UI_TEXT["vi"]["setting_font"], UI_TEXT["vi"]["setting_font_desc"], parent=self.displayGroup)
        self.displayGroup.addSettingCard(self.fontCard)
        self.vBoxLayout.addWidget(self.displayGroup)

        self.advGroup = SettingCardGroup(UI_TEXT["vi"]["setting_adv_group"], self.scrollWidget)
        self.bypassCard = SwitchSettingCard(FIF.UPDATE, UI_TEXT["vi"]["adv_bypass"], UI_TEXT["vi"]["adv_bypass_desc"], configItem=cfg.bypass_limit, parent=self.advGroup)
        self.coinCard = SwitchSettingCard(FIF.TAG, UI_TEXT["vi"]["adv_coin"], UI_TEXT["vi"]["adv_coin_desc"], configItem=cfg.auto_coin, parent=self.advGroup)
        self.arcanaCard = SwitchSettingCard(FIF.HEART, UI_TEXT["vi"]["adv_arcana"], UI_TEXT["vi"]["adv_arcana_desc"], configItem=cfg.auto_arcana, parent=self.advGroup)
        self.advGroup.addSettingCard(self.bypassCard)
        self.advGroup.addSettingCard(self.coinCard)
        self.advGroup.addSettingCard(self.arcanaCard)
        self.vBoxLayout.addWidget(self.advGroup)

        self.filterGroup = SettingCardGroup(UI_TEXT["vi"]["setting_filter_group"], self.scrollWidget)
        configs = [cfg.hide_common, cfg.hide_uncommon, cfg.hide_rare, cfg.hide_legendary, cfg.hide_immortal,
                   cfg.hide_arcana, cfg.hide_beyond, cfg.hide_celestial, cfg.hide_divine, cfg.hide_cosmic]
        self.cards = []
        for conf in configs:
            card = SwitchSettingCard(FIF.HIDE, "Hide", "Desc", configItem=conf, parent=self.filterGroup)
            self.cards.append(card)
            self.filterGroup.addSettingCard(card)
        self.vBoxLayout.addWidget(self.filterGroup)
        self.vBoxLayout.addStretch(1)

    def update_texts(self, lang_code):
        t = UI_TEXT[lang_code]
        try:
            self.titleLabel.setText(t["setting_title"])
            self.langLabel.setText(t["lang_label"])
            self.displayGroup.titleLabel.setText(t["setting_ui_group"])
            self.fontCard.titleLabel.setText(t["setting_font"])
            self.fontCard.contentLabel.setText(t["setting_font_desc"])
            self.filterGroup.titleLabel.setText(t["setting_filter_group"])
            self.advGroup.titleLabel.setText(t["setting_adv_group"])
            self.bypassCard.titleLabel.setText(t["adv_bypass"])
            self.bypassCard.contentLabel.setText(t["adv_bypass_desc"])
            self.coinCard.titleLabel.setText(t["adv_coin"])
            self.coinCard.contentLabel.setText(t["adv_coin_desc"])
            self.arcanaCard.titleLabel.setText(t["adv_arcana"])
            self.arcanaCard.contentLabel.setText(t["adv_arcana_desc"])
            
            rarities = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY", "IMMORTAL", "ARCANA", "BEYOND", "CELESTIAL", "DIVINE", "COSMIC"]
            colors_vi = ["Xám", "Xanh lá", "Xanh lam", "Cam", "Đỏ", "Hồng", "Tím", "Xanh lơ", "Đỏ nhạt", "Tím đậm"]
            colors_en = ["Gray", "Green", "Blue", "Orange", "Red", "Pink", "Purple", "Cyan", "Light Red", "Dark Purple"]
            colors = colors_vi if lang_code == "vi" else colors_en
            for i, card in enumerate(self.cards):
                card.titleLabel.setText(f"{t['hide']} {rarities[i]}")
                card.contentLabel.setText(f"{t['hide_desc']} {colors[i]}")
        except: pass

class TaskbarHeroToolUI(FluentWindow):
    signal_update_table = pyqtSignal()
    signal_log = pyqtSignal(str, str, bool) 
    signal_status = pyqtSignal(str, bool) 
    signal_alert = pyqtSignal(str, str) 

    def __init__(self):
        qconfig.set(qconfig.themeMode, Theme.DARK)
        setTheme(Theme.DARK)
        
        super().__init__()
        
        self.setWindowTitle(f"TBH Abyss - {CURRENT_VERSION}")
        try:
            base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            logo_path = os.path.join(base_path, "resources", "assets", "logo.ico")
            if os.path.exists(logo_path):
                self.setWindowIcon(QIcon(logo_path))
        except Exception:
            pass

        self.resize(1100, 750) 
        self.is_running = False
        self.is_first_load = True 
        
        self.baseline_data = {"normal": [], "boss": []}
        self.tracked_items = set()
        saved_tracked = cfg.tracked_items.value.strip()
        if saved_tracked:
            self.tracked_items = set(saved_tracked.split(','))
        self.alerted_items_indices = set() 
        
        self.consoleInterface = ConsoleInterface(self)
        self.dropInterface = DropInterface(self)
        self.dataInterface = DataInterface(self) 
        self.settingInterface = SettingInterface(self)
        self.initNavigation()
        
        self.consoleInterface.btnToggle.clicked.connect(self.toggle_tool)
        self.settingInterface.comboLang.currentTextChanged.connect(self.change_language) 
        self.dropInterface.btnAddWishlist.clicked.connect(self.add_wishlist)
        self.dropInterface.btnClearWishlist.clicked.connect(self.clear_wishlist)
        self.dataInterface.signal_toggle_track.connect(self.toggle_wishlist_item) 
        
        self.signal_update_table.connect(self.refresh_table)
        self.signal_log.connect(self.consoleInterface.print_log)
        self.signal_status.connect(self.show_toast_status)
        self.signal_alert.connect(self.show_alert_toast)
        
        cfg.font_size.valueChanged.connect(self.refresh_table)
        cfg.hide_common.valueChanged.connect(self.refresh_table)
        cfg.hide_uncommon.valueChanged.connect(self.refresh_table)
        cfg.hide_rare.valueChanged.connect(self.refresh_table)
        cfg.hide_legendary.valueChanged.connect(self.refresh_table)
        cfg.hide_immortal.valueChanged.connect(self.refresh_table)
        cfg.hide_arcana.valueChanged.connect(self.refresh_table)
        cfg.hide_beyond.valueChanged.connect(self.refresh_table)
        cfg.hide_celestial.valueChanged.connect(self.refresh_table)
        cfg.hide_divine.valueChanged.connect(self.refresh_table)
        cfg.hide_cosmic.valueChanged.connect(self.refresh_table)
        cfg.bypass_limit.valueChanged.connect(self.sync_advanced_configs)
        cfg.auto_coin.valueChanged.connect(self.sync_advanced_configs)
        cfg.auto_arcana.valueChanged.connect(self.sync_advanced_configs)
        
        self.frida_mgr = FridaManager(self.on_frida_message)
        self.apply_language() 

    def sync_advanced_configs(self):
        if self.is_running and hasattr(self.frida_mgr, 'script') and self.frida_mgr.script:
            payload = {
                "type": "update_config",
                "bypass_limit": cfg.bypass_limit.value,
                "auto_coin": cfg.auto_coin.value,
                "auto_arcana": cfg.auto_arcana.value
            }
            try:
                self.frida_mgr.script.post(payload)
                lang = "vi" if cfg.language.value == "Tiếng Việt" else "en"
                msg = "Đã đồng bộ cấu hình Hack xuống Game!" if lang == "vi" else "Synced advanced config to Game!"
                self.signal_log.emit(msg, "#4CAF50", False)
            except Exception as e:
                self.signal_log.emit(f"Lỗi đồng bộ: {e}", "#E57373", True)

    def initNavigation(self):
        self.addSubInterface(self.consoleInterface, FIF.COMMAND_PROMPT, UI_TEXT["vi"]["nav_console"])
        self.addSubInterface(self.dropInterface, FIF.APPLICATION, UI_TEXT["vi"]["nav_drop"])
        self.addSubInterface(self.dataInterface, FIF.LIBRARY, UI_TEXT["vi"]["nav_data"]) 
        self.addSubInterface(self.settingInterface, FIF.SETTING, UI_TEXT["vi"]["nav_setting"], position=NavigationItemPosition.BOTTOM)
        self.navigationInterface.setExpandWidth(180)

    def sync_tracking_state(self):
        cfg.tracked_items.value = ",".join(self.tracked_items)
        qconfig.save()
        
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        self.dropInterface.update_texts(lang_code, self.tracked_items)
        self.dataInterface.update_tracking_status(self.tracked_items)
        self.refresh_table()

    def toggle_wishlist_item(self, item_id):
        if item_id in self.tracked_items:
            self.tracked_items.remove(item_id)
        else:
            self.tracked_items.add(item_id)
        self.sync_tracking_state()

    def add_wishlist(self):
        raw_text = self.dropInterface.wishlistInput.text().strip()
        if not raw_text: return
        item_ids = re.split(r'[,\s]+', raw_text)
        added_count = 0
        for item_id in item_ids:
            if item_id.isdigit():
                self.tracked_items.add(item_id)
                added_count += 1
        if added_count > 0:
            self.dropInterface.wishlistInput.clear()
            self.sync_tracking_state()

    def clear_wishlist(self):
        self.tracked_items.clear()
        self.alerted_items_indices.clear()
        self.sync_tracking_state()

    def show_alert_toast(self, title, desc):
        InfoBar.success(title, desc, parent=self, position=InfoBarPosition.TOP, duration=6000)

    def change_language(self, text):
        cfg.language.value = text
        qconfig.save()
        self.apply_language()

    def apply_language(self):
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        t = UI_TEXT[lang_code]
        self.consoleInterface.update_texts(lang_code, self.is_running)
        self.settingInterface.update_texts(lang_code)
        self.dataInterface.start_loading(lang_code, self.tracked_items)
        self.dataInterface.update_texts(lang_code)
        self.sync_tracking_state() 
        try:
            self.navigationInterface.widget(self.consoleInterface.objectName()).setText(t["nav_console"])
            self.navigationInterface.widget(self.dropInterface.objectName()).setText(t["nav_drop"])
            self.navigationInterface.widget(self.dataInterface.objectName()).setText(t["nav_data"])
            self.navigationInterface.widget(self.settingInterface.objectName()).setText(t["nav_setting"])
        except: pass
        if self.is_first_load:
            self.signal_log.emit(t["log_ready"], "#E0E0E0", False)

    def toggle_tool(self):
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        t = UI_TEXT[lang_code]
        if not self.is_running:
            self.consoleInterface.btnToggle.setText(t["btn_stop"])
            self.consoleInterface.btnToggle.setIcon(FIF.PAUSE_BOLD)
            self.is_running = True
            threading.Thread(target=self.start_hook, daemon=True).start()
        else:
            self.consoleInterface.btnToggle.setText(t["btn_start"])
            self.consoleInterface.btnToggle.setIcon(FIF.PLAY)
            self.is_running = False
            self.signal_log.emit(t["log_detach"], "#E57373", False)
            success, msg = self.frida_mgr.detach()
            self.signal_log.emit(msg, "#FFB74D", False)

    def start_hook(self):
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        t = UI_TEXT[lang_code]
        self.signal_log.emit(f"{t['log_search']} {PROCESS_NAME}...", "#64B5F6", False)
        success, msg = self.frida_mgr.attach(PROCESS_NAME)
        if success:
            self.signal_log.emit(msg, "#81C784", True)
            self.signal_status.emit(msg, True)
            self.sync_advanced_configs()
        else:
            self.signal_log.emit(msg, "#E57373", True)
            self.signal_status.emit(msg, False)

    # =======================================================
    # BỘ GIẢI MÃ MỚI: TƯƠNG THÍCH HOÀN TOÀN VỚI SYNTTX.JS
    # =======================================================
    def on_frida_message(self, message, data):
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        
        if message['type'] == 'send':
            payload = message['payload']
            p_type = payload.get('type')
            
            if p_type == 'queues':
                parsed_data = {"normal": [], "boss": []}
                for q in payload.get('queues', []):
                    if q.get('eboxType') == 0:
                        parsed_data["normal"] = q.get('items', [])
                    elif q.get('eboxType') == 1:
                        parsed_data["boss"] = q.get('items', [])
                self.process_tracking_logic(parsed_data)
                
            elif p_type == 'log':
                self.signal_log.emit(payload.get('payload', ''), "#B0BEC5", False)
                
            elif p_type == 'ready':
                self.signal_log.emit(f"Lõi Synttx.js đã sẵn sàng: {payload.get('version')}", "#4CAF50", True)
                self.sync_advanced_configs()
                
            elif p_type == 'selected':
                item_id = payload.get('itemId')
                info = get_item_info(str(item_id), lang=lang_code)
                self.signal_log.emit(f"🎁 Game vừa nhả đồ: {info['name']} (ID: {item_id})", "#FFD54F", True)
                
            elif p_type == 'auto_stage_result':
                msg = payload.get('message', '')
                self.signal_log.emit(f"🗺️ Auto Stage: {msg}", "#64B5F6", False)
                
        elif message['type'] == 'error':
            self.signal_log.emit(f"Frida Error: {message.get('description', '')}", "#E57373", True)

    def process_tracking_logic(self, new_data):
        self.baseline_data["normal"] = new_data.get("normal", [])
        self.baseline_data["boss"] = new_data.get("boss", [])
        
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        t = UI_TEXT[lang_code]
        
        for chest_type in ["normal", "boss"]:
            for i, item_id in enumerate(self.baseline_data[chest_type]):
                item_id_str = str(item_id)
                if item_id_str in self.tracked_items:
                    alert_key = f"{chest_type}_{i}_{item_id_str}"
                    if alert_key not in self.alerted_items_indices:
                        info = get_item_info(item_id_str, lang=lang_code)
                        self.signal_alert.emit(t["alert_title"], f"{info['name']} ({item_id_str})\n{t['alert_desc']}")
                        self.alerted_items_indices.add(alert_key)
                        
        self.signal_update_table.emit()

    def refresh_table(self):
        font_size = cfg.font_size.value
        if font_size <= 0: font_size = 9 
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        font = QFont("Consolas" if lang_code == "en" else "Segoe UI", font_size)

        table_track = self.dropInterface.table_tracked
        table_track.setRowCount(0)
        sorted_tracked = sorted(list(self.tracked_items), key=lambda x: int(x) if x.isdigit() else x)
        for item_id_str in sorted_tracked:
            info = get_item_info(item_id_str, lang=lang_code)
            row = table_track.rowCount()
            table_track.insertRow(row)
            cells = [
                QTableWidgetItem(item_id_str),
                QTableWidgetItem(info["rarity"]),
                QTableWidgetItem(info["name"])
            ]
            for col, cell in enumerate(cells):
                cell.setFont(font)
                cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter if col < 2 else Qt.AlignmentFlag.AlignVCenter)
                cell.setForeground(QColor(info["color"])) 
                table_track.setItem(row, col, cell)
        table_track.resizeRowsToContents()

        active_filters = {
            "COMMON": cfg.hide_common.value, "UNCOMMON": cfg.hide_uncommon.value,
            "RARE": cfg.hide_rare.value, "LEGENDARY": cfg.hide_legendary.value,
            "IMMORTAL": cfg.hide_immortal.value, "ARCANA": cfg.hide_arcana.value,
            "BEYOND": cfg.hide_beyond.value, "CELESTIAL": cfg.hide_celestial.value,
            "DIVINE": cfg.hide_divine.value, "COSMIC": cfg.hide_cosmic.value,
        }

        def populate_table(table, chest_type_key):
            table.setRowCount(0)
            items = self.baseline_data[chest_type_key]
            
            for i, item_id in enumerate(items):
                item_id_str = str(item_id)
                info = get_item_info(item_id_str, lang=lang_code)
                is_tracked = item_id_str in self.tracked_items
                
                if not is_tracked:
                    if active_filters.get(info["rarity"], False):
                        continue
                        
                row = table.rowCount()
                table.insertRow(row)
                cells = [
                    QTableWidgetItem(str(i + 1)),
                    QTableWidgetItem(item_id_str),
                    QTableWidgetItem(info["rarity"]),
                    QTableWidgetItem(info["name"])  
                ]
                
                item_font = QFont(font)
                for col, cell in enumerate(cells):
                    cell.setFont(item_font)
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter if col < 3 else Qt.AlignmentFlag.AlignVCenter)
                    
                    if is_tracked:
                        f = cell.font()
                        f.setBold(True)
                        cell.setFont(f)
                        cell.setForeground(QColor(info["color"]))
                    elif col in [1, 2, 3]: 
                        cell.setForeground(QColor(info["color"])) 
                    else:
                        cell.setForeground(QColor("#E0E0E0")) 
                        
                    table.setItem(row, col, cell)
            table.resizeRowsToContents()

        populate_table(self.dropInterface.table_normal, "normal")
        populate_table(self.dropInterface.table_boss, "boss")

    def show_toast_status(self, msg, is_success):
        lang_code = "vi" if cfg.language.value == "Tiếng Việt" else "en"
        t = UI_TEXT[lang_code]
        if is_success:
            InfoBar.success(t["toast_success"], msg, parent=self, position=InfoBarPosition.TOP_RIGHT, duration=3000)
        else:
            InfoBar.error(t["toast_error"], msg, parent=self, position=InfoBarPosition.TOP_RIGHT, duration=5000)
            self.is_running = False
            self.consoleInterface.btnToggle.setText(t["btn_start"])
            self.consoleInterface.btnToggle.setIcon(FIF.PLAY)