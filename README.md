# 🛡️ TaskbarHero Tiên Tri (v4.0 - Frida Pro Edition)

> **"Tiên tri vạn vật - Làm chủ rương báu"**

`TaskbarHero Tiên Tri` là công cụ hỗ trợ người chơi game chuyên sâu, được thiết kế để giải mã dữ liệu trò chơi trong thời gian thực, giúp bạn theo dõi tỷ lệ rớt đồ và tối ưu hóa quy trình nhặt vật phẩm.

---

[Giao diện tool](resources/assets/readme_0.png)
[Giao diện tool](resources/assets/readme_1.png)
[Giao diện tool](resources/assets/readme_2.png)
[Giao diện tool](resources/assets/readme_3.png)
[Giao diện tool](resources/assets/readme_4.png)
[Giao diện tool](resources/assets/readme_5.png)
[Giao diện tool](resources/assets/readme_6.png)

---

## 🚀 Các tính năng "đắt giá"
* **Radar Tiên Tri:** Theo dõi danh sách vật phẩm trong rương (Normal/Boss) ngay lập tức.
* **Bộ lọc thông minh:** Ẩn các vật phẩm rác, chỉ tập trung vào trang bị/nguyên liệu giá trị.
* **Tối ưu hóa Arcana & Coin:** Tự động đẩy vật phẩm quan trọng lên đầu danh sách nhặt.
* **Bypass Map Cooldown:** Loại bỏ các giới hạn khó chịu khi chuyển Map hoặc thao tác quá nhanh.
* **Giao diện bóng đêm (Dark Mode):** Thiết kế tối giản, hiện đại và cực kỳ thân thiện với mắt.

---

## 🛠️ Yêu cầu hệ thống
* **Hệ điều hành:** Windows 10/11 (64-bit).
* **Môi trường:** Đã cài đặt [Visual C++ Redistributable 2015-2022](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170) (Nếu máy bạn chưa có).
* **Quyền hạn:** Cần chạy dưới quyền **Administrator** để công cụ có thể can thiệp vào bộ nhớ game.

---

## 📥 Hướng dẫn sử dụng
1. **Tải về:** Lấy file `main.exe` mới nhất từ bản build.
2. **Setup:** Bỏ file vào thư mục riêng (để tránh xung đột).
3. **Chạy Tool:** Click chuột phải vào `main.exe` chọn **Run as Administrator**.
4. **Tiêm mã:** Mở Game trước, đợi vào màn hình chính rồi mới bấm nút **"BẬT TOOL"**.
5. **Cấu hình:** Vào tab `Cài đặt` để bật/tắt các công tắc Hack tùy theo nhu cầu.

---

## ⚠️ Lưu ý bảo mật & Rủi ro
* Công cụ sử dụng phương pháp **Hooking bộ nhớ** (Frida), hệ thống Anti-Cheat của game có thể phát hiện nếu sử dụng không đúng cách.
* **KHUYẾN CÁO:** Hãy sử dụng tool khi game đã load hoàn tất. Tránh bật Hack ngay lúc vừa mở game để đảm bảo an toàn tối đa cho tài khoản.
* Người dùng tự chịu trách nhiệm với tài khoản của mình.

---

## 🛠️ Cho nhà phát triển (Dành cho Thành)
Nếu bạn muốn đóng gói lại tool, hãy sử dụng `build_tool.py`:
```bash
python build_tool.py