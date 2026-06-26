# config/settings.py
import os
# Lưu ý: Đã import thêm "Theme" ở dòng dưới
from qfluentwidgets import (QConfig, OptionsConfigItem, OptionsValidator, 
                            RangeConfigItem, RangeValidator, ConfigItem, 
                            BoolValidator, qconfig, Theme) 

PROCESS_NAME = "TaskbarHero.exe"
MODULE_NAME = "GameAssembly.dll"
CURRENT_VERSION = "v4.0 - Abyss"

# ==========================================
# CẤU HÌNH LƯU TRỮ TỰ ĐỘNG
# ==========================================
class AppConfig(QConfig):
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
    
    # 3 Công tắc Hack
    bypass_limit = ConfigItem("Advanced", "BypassLimit", False)
    auto_coin = ConfigItem("Advanced", "AutoCoin", False)
    auto_arcana = ConfigItem("Advanced", "AutoArcana", False)

    # Track
    tracked_items = ConfigItem("User", "TrackedItems", "")

cfg = AppConfig()

app_data_path = os.getenv('LOCALAPPDATA')
config_dir = os.path.join(app_data_path, "TaskbarHeroTool")
os.makedirs(config_dir, exist_ok=True) 

config_file_path = os.path.join(config_dir, "config.json")
qconfig.load(config_file_path, cfg)

cfg.bypass_limit.value = False
cfg.auto_coin.value = False
cfg.auto_arcana.value = False
# ==========================================
# 👑 ÉP BUỘC DARK MODE TỪ TRONG TRỨNG NƯỚC
# Lệnh này sẽ chặn đứng mọi can thiệp từ Windows của người khác!
# ==========================================
qconfig.set(qconfig.themeMode, Theme.DARK)