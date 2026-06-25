# config/settings.py
from qfluentwidgets import (QConfig, OptionsConfigItem, OptionsValidator, 
                            RangeConfigItem, RangeValidator, ConfigItem, 
                            BoolValidator, qconfig)

PROCESS_NAME = "TaskbarHero.exe"
MODULE_NAME = "GameAssembly.dll"
CURRENT_VERSION = "v4.0 - FRIDA PRO EDITION"

# ==========================================
# CẤU HÌNH LƯU TRỮ TỰ ĐỘNG (AUTO-SAVE SETTINGS)
# ==========================================
class AppConfig(QConfig):
    # Khai báo các biến cài đặt, có giá trị mặc định đi kèm
    language = OptionsConfigItem("UI", "Language", "Tiếng Việt", OptionsValidator(["Tiếng Việt", "English"]), restart=False)
    font_size = RangeConfigItem("UI", "FontSize", 11, RangeValidator(8, 20))
    hide_common = ConfigItem("Filters", "HideCommon", False)
    hide_uncommon = ConfigItem("Filters", "HideUncommon", False)
    hide_rare = ConfigItem("Filters", "HideRare", False)
    hide_legendary = ConfigItem("Filters", "HideLegendary", False)
    hide_immortal = ConfigItem("Filters", "HideImmortal", False)
    hide_arcana = ConfigItem("Filters", "HideArcana", False)
    hide_beyond = ConfigItem("Filters", "HideBeyond", False)
    hide_celestial = ConfigItem("Filters", "HideCelestial", False)
    hide_divine = ConfigItem("Filters", "HideDivine", False)
    hide_cosmic = ConfigItem("Filters", "HideCosmic", False)

# Khởi tạo đối tượng config
cfg = AppConfig()

# Tự động load (hoặc tạo mới) file config.json ở thư mục gốc
qconfig.load('config.json', cfg)