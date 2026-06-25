# core/frida_manager.py
import frida
import os

class FridaManager:
    def __init__(self, on_message_callback):
        self.session = None
        self.script = None
        self.on_message_callback = on_message_callback

    def attach(self, process_name):
        try:
            self.session = frida.attach(process_name)
            js_path = os.path.join(os.path.dirname(__file__), "agent.js")
            with open(js_path, "r", encoding="utf-8") as f:
                js_code = f.read()
                
            self.script = self.session.create_script(js_code)
            self.script.on('message', self.on_message_callback)
            self.script.load()
            return True, "Tiêm mã Frida thành công!"
        except Exception as e:
            return False, f"Lỗi Frida: {e}"

    def detach(self):
        """Hàm rút tiêm Frida (Tắt tool)"""
        try:
            if self.session:
                self.session.detach()
            self.session = None
            self.script = None
            return True, "Đã ngắt kết nối Frida an toàn."
        except Exception as e:
            return False, f"Lỗi khi ngắt kết nối: {e}"

    def scan_drop_data(self, address_hex):
        if self.script:
            self.script.exports_sync.trigger_scan(address_hex)