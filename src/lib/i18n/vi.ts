// Toàn bộ chuỗi hiển thị tiếng Việt. Port từ strings_vi.py của bản gốc,
// thêm các khóa mới cho tab, danh sách waypoint, cài đặt và hướng dẫn.
// Không file UI nào được viết thẳng chuỗi hiển thị.

export const vi = {
  // --- chung ---
  "app.title": "Bản đồ The Isle",
  "app.minimap_title": "Bản đồ nhỏ",
  "app.fullmap_title": "Bản đồ Gateway",

  // --- tab ---
  "tab.map": "Bản đồ",
  "tab.dino": "Khủng long",
  "tab.settings": "Cài đặt",
  "tab.garage": "Garage",
  "tab.guide": "Hướng dẫn",
  "tab.donate": "Ủng hộ",

  // --- trạng thái vị trí ---
  "pos.none": "Chưa có vị trí",
  "pos.hint":
    "Trong game bấm Tab, rồi bấm chuột vào “Asset Location” ở góc trên bên phải để chép tọa độ.",
  "pos.off_map": "Ngoài bản đồ",

  // --- hướng ---
  "dir.N": "Bắc",
  "dir.NE": "Đông Bắc",
  "dir.E": "Đông",
  "dir.SE": "Đông Nam",
  "dir.S": "Nam",
  "dir.SW": "Tây Nam",
  "dir.W": "Tây",
  "dir.NW": "Tây Bắc",
  "heading.unknown": "Chưa rõ hướng",
  "heading.hint": "Chép tọa độ lần nữa sau khi di chuyển để biết hướng đi.",

  // --- layer POI ---
  "layer.freshwater": "Nước ngọt",
  "layer.water": "Nguồn nước",
  "layer.sanctuary": "Khu bảo tồn",
  "layer.migration": "Vùng di cư",
  "layer.saltlick": "Mỏ muối",
  "layer.mudwallow": "Vũng bùn",
  "layer.food": "Khu vực thức ăn",
  "layer.patrol": "Vùng tuần tra AI",
  "layer.region": "Tên vùng",
  "layer.landmark": "Địa điểm",
  "layer.animal": "Động vật",
  "layers.title": "Lớp bản đồ",
  "layers.zone_labels": "Tên vùng khoanh",
  "layers.collapse": "Thu gọn",
  "layers.expand": "Mở rộng",

  // --- waypoint ---
  "wp.title": "Điểm đánh dấu",
  "wp.new": "Điểm đánh dấu mới",
  "wp.add": "Thêm điểm",
  "wp.remove": "Xóa điểm",
  "wp.rename": "Đổi tên",
  "wp.name_prompt": "Tên điểm đánh dấu:",
  "wp.empty": "Chưa có điểm nào. Bấm chuột phải lên bản đồ để thêm.",
  "wp.distance": "{dir} · {dist}",
  "wp.here": "Vị trí của tôi",
  "wp.confirm_delete": "Xóa điểm “{name}”?",
  "wp.color": "Đổi màu",

  // --- tìm kiếm & điều hướng ---
  "search.placeholder": "Tìm địa danh hoặc dán tọa độ…",
  "search.goto_coords": "Tới tọa độ đã nhập",
  "search.no_results": "Không thấy địa danh nào",
  "search.coords_failed": "Không đọc được tọa độ — kiểm tra lại chuỗi đã dán",
  "map.recenter": "Về vị trí của tôi",

  // --- vết đường ---
  "trail.title": "Đường đã đi",
  "trail.previous": "Đường đi phiên trước",
  "trail.clear": "Xóa đường đi",
  "trail.clear_hint":
    "Xóa vết trên cả hai bản đồ cho đỡ rối; file lịch sử trên máy vẫn giữ nguyên.",

  // --- nút chung ---
  "btn.close": "Đóng",
  "btn.ok": "Đồng ý",
  "btn.cancel": "Hủy",
  "btn.save": "Lưu",

  // --- cảnh báo ---
  "warn.exclusive_fullscreen":
    "Game đang chạy chế độ Toàn màn hình. Bản đồ nhỏ sẽ không hiện đè lên được. " +
    "Hãy vào Cài đặt › Hình ảnh trong game và đổi sang “Cửa sổ” hoặc “Toàn màn hình không viền”.",
  "warn.hotkey_failed":
    "Không đăng ký được các phím tắt sau, vì ứng dụng khác đang giữ chúng:",
  "warn.no_data":
    "Chưa có dữ liệu bản đồ trên máy. Cần tải về một lần trước khi dùng.",

  // --- phím tắt (tên hành động) ---
  "hotkey.toggle_minimap": "Hiện/ẩn bản đồ nhỏ",
  "hotkey.toggle_fullmap": "Mở/đóng bản đồ lớn",
  "hotkey.toggle_click_through": "Bật/tắt chế độ bấm được",
  "hotkey.mark_here": "Đánh dấu vị trí hiện tại",
  "hotkey.opacity_up": "Bản đồ nhỏ đậm hơn",
  "hotkey.opacity_down": "Bản đồ nhỏ nhạt hơn",
  "hotkey.zoom_in": "Thu gần vùng nhìn",
  "hotkey.zoom_out": "Nhìn xa hơn",
  "hotkey.toggle_quests": "Hiện/ẩn bảng nhiệm vụ Prime",
  "hotkey.reload_ui": "Tải lại giao diện (khi bị đơ)",

  // --- cài đặt ---
  "settings.language": "Ngôn ngữ · Language",
  "settings.minimap": "Bản đồ nhỏ",
  "settings.visible": "Hiện bản đồ nhỏ",
  "settings.require_game": "Chỉ hiện khi đang trong game (Alt-Tab ra là tự ẩn)",
  "settings.click_through": "Chuột bấm xuyên qua (không cản trở lúc chơi)",
  "settings.show_trail": "Hiện đường đi trên bản đồ nhỏ",
  "settings.show_waypoints": "Hiện waypoint trên bản đồ nhỏ",
  "settings.corner": "Góc neo theo cửa sổ game",
  "corner.top-left": "Trên trái",
  "corner.top-right": "Trên phải",
  "corner.bottom-left": "Dưới trái",
  "corner.bottom-right": "Dưới phải",
  "settings.size": "Kích thước",
  "settings.margin": "Cách mép",
  "settings.opacity": "Độ đậm",
  "settings.radius": "Bán kính vùng nhìn",
  "settings.hotkeys": "Phím tắt",
  "settings.hotkeys_hint":
    "Bấm vào ô phím rồi nhấn tổ hợp mới. Cần ít nhất một phím bổ trợ (Ctrl/Alt/Shift/Win).",
  "settings.press_keys": "Nhấn tổ hợp phím… (Esc để hủy)",
  "settings.hotkey_in_use": "Tổ hợp này đang bị ứng dụng khác giữ",
  "settings.hotkey_duplicate": "Trùng với một phím tắt khác trong ứng dụng",
  "settings.hotkey_invalid": "Tổ hợp không hợp lệ — cần ít nhất một phím bổ trợ",
  "settings.number_format": "Định dạng số tọa độ",
  "format.auto": "Tự động nhận biết",
  "format.us": "Kiểu Mỹ — 1,234.5",
  "format.eu": "Kiểu Châu Âu — 1.234,5",
  "settings.data": "Dữ liệu",
  "settings.open_trails": "Mở thư mục đường đi",
  "settings.redownload": "Tải lại dữ liệu bản đồ",
  "settings.basemap": "Nền bản đồ",
  "basemap.vulnona": "Vulnona (mặc định)",
  "basemap.islemaps_light": "IsleMaps — sáng",
  "basemap.islemaps_dark": "IsleMaps — tối",
  "basemap.hint":
    "Áp dụng cho cả bản đồ lớn lẫn bản đồ nhỏ. Lần đầu chọn sẽ tải ảnh nền " +
    "(~5–7 MB) về máy — sau đó dùng offline. Bản IsleMaps vẽ theo phiên bản game " +
    "mới hơn, thấy cả quần đảo đông nam (Hell's Mouth).",
  "basemap.downloading": "Đang tải ảnh nền…",
  "basemap.failed":
    "Tải ảnh nền thất bại — kiểm tra mạng rồi thử lại. Vẫn dùng nền hiện tại.",

  // --- chạy lần đầu ---
  "firstrun.title": "Tải dữ liệu bản đồ",
  "firstrun.explain":
    "Ứng dụng cần tải ảnh bản đồ (~3 MB) và dữ liệu điểm về máy bạn một lần. " +
    "Dữ liệu được tải trực tiếp từ nguồn thay vì đóng gói sẵn — đây là bản sao cá nhân " +
    "trên máy bạn, không phải bản phát hành lại.",
  "firstrun.start": "Bắt đầu tải",
  "firstrun.downloading": "Đang tải…",
  "firstrun.done": "Xong! Đang mở bản đồ…",
  "firstrun.partial":
    "Đã tải được ảnh bản đồ nhưng dữ liệu điểm bị lỗi. Bạn vẫn dùng được bản đồ; " +
    "thử tải lại dữ liệu trong phần Cài đặt sau.",
  "firstrun.failed": "Tải thất bại. Kiểm tra kết nối mạng rồi thử lại.",
  "firstrun.retry": "Thử lại",
  "firstrun.continue": "Tiếp tục với bản đồ",

  // --- khủng long của bạn (IslePilot) ---
  "dino.title": "Khủng long của bạn",
  "dino.explain":
    "Đọc thông tin khủng long của chính bạn từ trang quản lý IslePilot của server " +
    "(growth, máu, đói, khát, Prime progress). Chỉ là kết nối HTTPS tới website của server " +
    "— không đụng gì tới game, an toàn với anti-cheat.",
  "dino.server": "Server",
  "dino.login": "Đăng nhập Steam",
  "dino.login_wait": "Đang chờ bạn đăng nhập trong cửa sổ vừa mở…",
  "dino.login_failed": "Đăng nhập không thành công. Thử lại.",
  "dino.logged_in": "Đã đăng nhập",
  "dino.logout": "Đăng xuất",
  "dino.auth_expired": "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.",
  "dino.supported_servers":
    "Hỗ trợ mọi server chạy IslePilot — dạng xxx.islepilot.eu hoặc islepilot.eu/p/tên-server. " +
    "Xem danh sách ví dụ và hướng dẫn từng bước trong tab Hướng dẫn.",
  "dino.manual_cookie": "Dán cookie đăng nhập",
  "dino.manual_cookie_hint":
    "Mở trang server trong trình duyệt và đăng nhập Steam. Bấm F12 → tab Application " +
    "(Chrome) hoặc Storage (Firefox) → Cookies → chọn domain server → tìm cookie tên " +
    "islepilot_player rồi copy phần Value dán vào đây.",
  "dino.cancel_login": "Hủy đăng nhập",
  "dino.manual_cookie_save": "Kiểm tra & lưu cookie",
  "dino.manual_cookie_checking": "Đang kiểm tra cookie…",
  "dino.manual_cookie_bad":
    "Cookie không hợp lệ hoặc phiên chưa đăng nhập — kiểm tra lại chuỗi đã dán.",
  "dino.server_settings": "Cài đặt server",
  "dino.token_login": "Đăng nhập Steam (1 lần, dùng cho mọi server)",
  "dino.token_login_hint":
    "Đăng nhập qua islepilot.eu một lần duy nhất — token dùng chung cho MỌI server IslePilot " +
    "(mixi, hoho, sdvn…), không cần nhập server hay copy cookie nữa. Đổi server trong game " +
    "là dữ liệu tự đổi theo.",
  "dino.token_paste": "Hoặc dán token thủ công",
  "dino.token_paste_hint":
    "Nếu cửa sổ đăng nhập không tự bắt được token: dán token overlay (hoặc nguyên link " +
    "theisle-overlay://… / isle-overlay://…) vào đây.",
  "dino.token_save": "Kiểm tra & lưu token",
  "dino.token_checking": "Đang kiểm tra token…",
  "dino.token_bad": "Token không hợp lệ — kiểm tra lại chuỗi đã dán.",
  "dino.legacy_section": "Cách cũ: nhập server + cookie (dự phòng)",
  "dino.legacy_hint":
    "Chỉ cần khi cách đăng nhập mới không hoạt động với server của bạn. Cookie lưu riêng " +
    "cho từng server.",
  "dino.live_map_yes": "Server có live map — vị trí sẽ tự cập nhật",
  "dino.live_map_checking": "Đang kiểm tra live map của server…",
  "dino.enabled": "Theo dõi thông tin khủng long",
  "dino.interval": "Tần suất cập nhật",
  "dino.overlay_panel": "Hiện thanh chỉ số dưới bản đồ nhỏ",
  "dino.quests_panel": "Hiện nhiệm vụ Prime dưới bản đồ nhỏ",
  "dino.use_map_position":
    "Lấy vị trí tự động từ live map của server (thay cho copy tọa độ thủ công)",
  "dino.rules_note":
    "⚠ Nên hỏi admin server trước khi dùng thường xuyên — một số server có luật riêng về " +
    "công cụ bên thứ ba. Dữ liệu hiển thị chỉ là của chính bạn, do panel của server cung cấp.",
  "dino.growth": "Trưởng thành",
  "dino.health": "Máu",
  "dino.hunger": "Đói",
  "dino.thirst": "Khát",
  "dino.stamina": "Thể lực",
  "dino.nutrition": "Dinh dưỡng",
  "dino.nutrition_carb": "Carb",
  "dino.nutrition_protein": "Đạm",
  "dino.nutrition_lipid": "Béo",
  "dino.server_playing": "Server",
  "dino.sex_female": "Cái",
  "dino.sex_male": "Đực",
  "dino.prime": "Prime progress",
  "dino.online": "Online",
  "dino.offline": "Offline",
  "dino.updated": "Cập nhật lúc {time}",
  "dino.no_data": "Chưa có dữ liệu — bật theo dõi và chờ lần cập nhật đầu.",
  "dino.fetch_error": "Lỗi kết nối tới panel:",
  "dino.layout_changed":
    "IslePilot vừa cập nhật phiên bản mới — nếu số liệu trông sai, giao diện của họ có thể " +
    "đã đổi và app cần cập nhật theo.",
  "dino.map_disabled": "Server này tắt live map.",
  "dino.crashed":
    "Phần Khủng long gặp lỗi và đã được cách ly — bản đồ và các tính năng khác không bị ảnh hưởng.",

  // --- garage (gacha) — chỉ có ở chế độ đăng nhập token ---
  "garage.title": "Garage (Gacha)",
  "garage.hint":
    "Danh sách khủng long đã gửi vào garage của server. Park/Restore mất tới ~60 giây " +
    "vì server xử lý bất đồng bộ.",
  "garage.refresh": "Làm mới",
  "garage.park": "Park dino hiện tại",
  "garage.restore": "Restore",
  "garage.sell": "Bán",
  "garage.rename": "Đổi tên",
  "garage.rename_prompt": "Tên mới cho dino:",
  "garage.confirm_restore": "Restore dino “{name}”? Dino đang chơi có thể bị thay thế.",
  "garage.confirm_sell": "Bán dino “{name}”? Không thể hoàn tác.",
  "garage.empty": "Garage trống.",
  "garage.busy": "Đang gửi lệnh tới server… (tối đa ~60 giây)",
  "garage.error": "Lệnh thất bại:",
  "garage.sold": "Đã bán — nhận {amount} {currency}",
  "garage.done": "Xong!",
  "garage.need_token":
    "Garage cần đăng nhập Steam qua IslePilot (1 lần, dùng cho mọi server) — vào tab " +
    "Khủng long để đăng nhập. Cách cũ nhập server + cookie không dùng được Garage.",
  "garage.unsupported":
    "Không lấy được Garage — server bạn đang chơi có thể không hỗ trợ tính năng này.",
  "garage.updated":
    "Cập nhật lúc {time} · tự làm mới sau mỗi 10 phút — bấm Làm mới nếu cần ngay.",

  // --- xem 3D ---
  "dino3d.loading": "Đang tải model 3D…",
  "dino3d.no_model": "Loài này chưa có model 3D.",
  "dino3d.error": "Không tải được model 3D — kiểm tra mạng rồi thử lại.",

  // --- POI IslePilot trên bản đồ ---
  "layer.islepilot": "POI server (IslePilot)",
  "poi.islepilot_discord":
    "Cần liên kết Discord với IslePilot để mở khóa bản đồ server.",
  "poi.islepilot_disabled": "Server này tắt live map.",
  "poi.islepilot_login": "Đăng nhập token (tab Khủng long) để hiện POI của server.",
  "poi.islepilot_empty": "Server chưa có POI nào.",
  "map.crashed":
    "Bản đồ gặp lỗi hiển thị. Bấm Thử lại, hoặc nhấn F5 để tải lại toàn bộ ứng dụng.",
  "btn.retry": "Thử lại",

  // --- cập nhật ---
  "update.available": "Có bản cập nhật {version}",
  "update.install": "Cập nhật ngay",
  "update.installing": "Đang tải bản cập nhật…",
  "update.later": "Để sau",

  // --- footer + donate ---
  "footer.developed_by": "Được phát triển bởi",
  "footer.donate": "Ủng hộ",
  "footer.reload_hint": "Nếu ứng dụng bị lỗi, nhấn F5 hoặc Ctrl+Alt+R để tải lại",
  "donate.title": "Ủng hộ tác giả",
  "donate.hint": "Quét mã VietQR bằng app ngân hàng, hoặc chuyển khoản thủ công:",
  "donate.copy_stk": "Copy số tài khoản",
  "donate.copied": "Đã copy!",
  "donate.thanks": "Cảm ơn bạn đã ủng hộ! ❤",


  // --- số liệu sử dụng & phản hồi ---
  "telemetry.title": "Số liệu sử dụng & phản hồi",
  "telemetry.enabled": "Gửi số liệu sử dụng ẩn danh",
  "telemetry.hint":
    "Chỉ gồm: một mã cài đặt ngẫu nhiên, phiên bản app, số hiệu bản Windows, " +
    "ngôn ngữ giao diện và số lần dùng từng tính năng. Không gửi địa chỉ IP, " +
    "không gửi vị trí trong game, không gửi tên tài khoản Windows.",
  "feedback.title": "Gửi phản hồi",
  "feedback.cat_bug": "Lỗi",
  "feedback.cat_idea": "Góp ý",
  "feedback.cat_other": "Khác",
  "feedback.body": "Mô tả (tối đa 2000 ký tự)",
  "feedback.contact": "Cách liên hệ lại (không bắt buộc)",
  "feedback.send": "Gửi",
  "feedback.sending": "Đang gửi…",
  "feedback.sent": "Đã gửi. Cảm ơn bạn!",
  "feedback.failed": "Không gửi được. Kiểm tra mạng rồi thử lại.",
  // --- ghi công ---
  "credits.title": "Nguồn dữ liệu",
  "credits.body":
    "Ảnh nền: VulnonaMAP (Coco.N) — ghép từ ảnh chụp trong game. " +
    "Nền IsleMaps & điểm động vật: IsleMaps.com (Pont & Emeara). " +
    "Hình ảnh thuộc bản quyền Afterthought LLC (The Isle). " +
    "Dữ liệu điểm: VulnonaMAP, myislemap.com, hướng dẫn Steam của wiredredman. " +
    "Ứng dụng này không liên kết với Afterthought LLC.",
} as const;

export type MsgKey = keyof typeof vi;
