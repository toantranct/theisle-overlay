# Changelog

Mọi thay đổi đáng chú ý của TheIsle Overlay được ghi tại đây, theo định dạng
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/) và đánh số phiên bản
[SemVer](https://semver.org/lang/vi/). Mã trong ngoặc là commit tương ứng.

## [Chưa phát hành]

### Thêm

- **Tỷ lệ thu phóng minimap** (`minimap.zoom`, mặc định 1.0×): bộ trượt mới
  trong Cài đặt › Bản đồ nhỏ, khoảng 0.5× đến 2×. Hoạt động **cộng dồn** với
  "Bán kính vùng nhìn": radius chia cho zoom, nên bán kính 600 m với zoom 2×
  cho vùng nhìn thực 300 m (phóng to gấp đôi), 0.5× cho 1200 m (thu nhỏ một
  nửa). Ngưỡng mũi tên waypoint ở rìa và bộ lọc khoảng cách POI cũng bám
  theo. Phím tắt `Ctrl+Alt+Right/Left` (zoom in/out) vẫn dùng được như cũ.
  (`f024058`)
- **% còn lại sau HP / đói / khát / thể lực trên dải chỉ số của minimap**:
  thay vì chỉ `75/100`, giờ hiện `75/100 (75%)` — số trong ngoặc là phần trăm
  hiện có, khớp với thanh bar bên cạnh để liếc một cái là biết tình trạng.
  Thanh bar được rút ngắn lại cho vừa chỗ, định dạng `—` vẫn giữ khi dữ liệu
  chưa có. Đã sửa lỗi chia cho 0 ở nhánh text (khi `max = 0`, ví dụ stamina
  chưa khởi tạo) bằng cách dùng cùng truthy guard với nhánh thanh bar — trước
  đây hiện `0/0 (NaN%)`. (`f024058`)

### Sửa

- **Dải chỉ số minimap cao thêm 4px** (`PANEL_H` 76 → 80): chừa chỗ cho
  dòng "Growth XX%" cuối panel khỏi sát mép dưới; trước đây dễ bị cảm giác
  bị cắt ở kích thước minimap nhỏ hoặc DPI cao. (`2b374f4` đã sửa race lúc
  khởi động khiến dòng Growth và panel Prime bị cắt; thay đổi này chỉ thêm
  4 px thoáng dưới dòng Growth.)

## [1.5.2] — 2026-08-25

### Thay đổi

- **Quay lại tab Bản đồ là hiện ngay, giữ nguyên chỗ đang xem**: trước đây rời tab Bản
  đồ là toàn bộ Leaflet bị huỷ, quay lại phải dựng lại từ đầu — khoảng 16 lượt gọi tuần
  tự sang Rust, đọc và parse lại 120 KB điểm quan tâm, dựng lại 634 đối tượng lớp (608
  trong số đó thuộc lớp đang tắt), nạp lại ảnh nền 7800×7817 — và mất luôn mức zoom, vị
  trí đã kéo. Số liệu sử dụng cho thấy người chơi quay lại tab này khoảng 2 lần mỗi
  phiên. Giờ bản đồ được giữ sống khi ẩn (đúng cách tab Khủng long và Garage đã làm);
  trong lúc ẩn, mẫu vị trí và đường đi chỉ được ghi nhớ chứ không vẽ, không kéo bản đồ,
  không hỏi Rust waypoint gần nhất — quay lại là vẽ đúng một lần từ mẫu mới nhất. Đổi
  nền bản đồ từ tab Cài đặt vẫn dựng lại đúng khung nhìn dù bản đồ đang ẩn. (`a2c2bdb`)
- **Bật/tắt lớp bản đồ không còn quét hai lần**: mỗi cú bấm trước đây duyệt toàn bộ nhóm
  lớp hai lượt (một từ ô tick, một từ thông báo cài đặt vòng về), và *mọi* thay đổi cài
  đặt khác — phím tắt độ đậm minimap, đổi ngôn ngữ, cả thông báo đồng bộ theo từng mẫu vị
  trí — cũng khiến bản đồ lớn duyệt lại toàn bộ lớp. Giờ chỉ duyệt khi trạng thái lớp thực
  sự thay đổi. (`a2c2bdb`)
- **Dữ liệu điểm quan tâm được cache phía Rust**: ba nơi gọi (bản đồ lớn lúc mở và sau
  mỗi lần tải dữ liệu, cửa sổ minimap) trước đây mỗi nơi tự đọc, parse và chiếu toạ độ
  lại toàn bộ file. Cache khoá theo nền bản đồ và dấu thời gian file, nên tải lại dữ liệu
  hay đổi nền tự làm mới, không cần ai nhớ xoá. (`a2c2bdb`)
- **Đo đạc sử dụng đúng hơn**: nhãn `dino3d_view` thực chất đo việc mở tab Khủng long
  (tab đó không có 3D — viewer nằm ở Garage), đổi thành `dino_tab_open`; `fullmap_open`
  không còn tự cộng một lượt mỗi lần mở app, vì số lần mở app đã có ô riêng. (`a2c2bdb`)

### Sửa

- **Lỗi hiếm "Cannot read properties of undefined (reading '_leaflet_pos')"** (1 báo cáo
  trên 1.5.1): Leaflet kết thúc animation zoom bằng một bộ hẹn giờ 250 ms sống lâu hơn
  `map.remove()`; lăn chuột zoom rồi bấm sang tab khác trong khoảng đó là bộ hẹn giờ
  chạm vào một bản đồ đã bị huỷ. Cùng họ với lỗi `'on'` của 1.5.0 — đều là bản đồ bị huỷ
  giữa chừng. Việc giữ bản đồ sống ở trên xoá luôn đường huỷ-khi-chuyển-tab; thêm chốt
  chặn cho đường còn lại khi đổi nền. (`7931471`)

## [1.5.1] — 2026-08-24

### Sửa

- **Bản đồ lớn thỉnh thoảng trống, không phản hồi** (báo lỗi tự động đầu tiên
  của 1.5.0: `Cannot read properties of undefined (reading 'on')`, 7 lần trên
  một máy): rời tab Bản đồ hoặc đổi nguồn bản đồ khi bản đồ chưa tải xong (máy
  chậm) làm phần tải tiếp tục chạy trên một bản đồ đã bị gỡ. Lỗi có từ trước,
  1.5.0 chỉ là bản đầu tiên nhìn thấy nó nhờ báo lỗi tự động. (`f5850e5`)
- **Minimap bật lại nhưng nằm dưới game**: sau khi tắt, game (hoặc overlay
  Steam/Discord) có thể chen lên trên trong nhóm cửa sổ "luôn trên cùng"; bật
  lại thì Windows trả minimap về đúng vị trí cũ — dưới game — và vòng kiểm tra
  2 giây không nhận ra vì cờ "trên cùng" vẫn còn. Giờ ép lên trên cùng ngay mỗi
  lần hiện. (`f5850e5`)
- **Ô "Hiện minimap" trong Cài đặt không đổi khi bấm hotkey**: đang mở tab Cài
  đặt mà bấm `Ctrl+Alt+M` tắt minimap thì ô vẫn tích, bấm vào "để bật lại" thực
  ra lại gửi lệnh tắt. Màn Cài đặt giờ nghe thay đổi từ hotkey. (`f5850e5`)

## [1.5.0] — 2026-08-24

### Thêm

- **Số liệu sử dụng ẩn danh**: app gửi một ping mỗi lần khởi động tới backend riêng
  trên Cloudflare Workers, để biết có bao nhiêu người còn dùng, phiên bản nào còn
  chạy ngoài thực tế, và **tính năng nào hay được mở** — cơ sở để quyết định nên tối
  ưu chỗ nào thay vì đoán. Số lần dùng từng tính năng được đếm cục bộ trong bộ nhớ,
  ghi xuống đĩa mỗi 60 giây (app overlay hay bị tắt cứng hơn là đóng sạch) rồi gửi
  kèm ping lần mở kế tiếp — nên **một lần mở app chỉ tốn đúng một request**, không
  phải một request mỗi lần bấm. Những gì được gửi: một mã cài đặt ngẫu nhiên, phiên
  bản app, số hiệu bản Windows, ngôn ngữ giao diện, và các bộ đếm đó. **Không gửi địa
  chỉ IP** — máy chủ chỉ lấy mã quốc gia từ biên Cloudflare rồi bỏ địa chỉ đi; không
  gửi vị trí trong game; không gửi tên tài khoản Windows. Tắt được bất cứ lúc nào ở
  **Cài đặt → Số liệu sử dụng & phản hồi**. Mất mạng hay backend chết thì app im lặng
  bỏ qua, không hiện lỗi và không chờ. (`ac28f61`)
- **Gửi phản hồi ngay trong app**: mục mới ở cuối màn Cài đặt — chọn Lỗi / Góp ý /
  Khác, mô tả vấn đề, để lại cách liên hệ nếu muốn nhận trả lời. Gửi trùng đúng một
  nội dung nhiều lần chỉ tính một. Nút này không phụ thuộc công tắc số liệu ở trên:
  bấm Gửi là đồng ý gửi đúng tin nhắn đó, không hơn. (`ac28f61`)
- **Báo lỗi tự động**: khi app hoặc giao diện gặp lỗi không bắt được, một báo cáo gọn
  (loại lỗi + vài dòng stack đầu) được gửi để sửa. Đường dẫn Windows được thay
  `C:\Users\<tên>\` bằng `%USERPROFILE%\` **ngay trên máy bạn trước khi gửi**, nên tên
  tài khoản không bao giờ rời khỏi máy. Tối đa 3 báo cáo mỗi lần chạy và 10 mỗi ngày
  — app kẹt vòng lặp lỗi cũng không thể spam. (`ac28f61`)

## [1.4.3] — 2026-08-23

### Sửa

- **Vùng khoanh hình đa giác không hiện trên bản đồ**: tầng render bắt mọi điểm phải có
  toạ độ tâm `x`/`y`, nhưng vùng đa giác chỉ mang danh sách đỉnh `points` — nên bị loại
  bỏ trước cả khi đọc tới đỉnh. Kết quả: **vùng di cư chỉ hiện 4/12** (mất Swamp,
  South Plains, NE Cape, Southern Beach, Highlands, Northern Jungle, East Jungle,
  Delta), **khu bảo tồn 1/7**, **vùng tuần tra AI 27/61**. Giờ tâm vùng được tính
  từ trọng tâm các đỉnh, mọi vùng đều vẽ đủ. Lỗi có từ bản Tauri đầu tiên. (`39c42e8`)

### Thêm

- **Vùng di cư Lagoon**: myislemap và Vulnona mỗi bên thiếu một vùng của bên kia,
  nên lớp vùng di cư giờ hợp cả hai nguồn (12 → 13 vùng): giữ nguyên hình dạng từ
  myislemap, bổ sung `Lagoon` đọc từ mục `dir Migration` của Vulnona `data_1.txt`.
  Tên trùng được khớp chuẩn hoá nên `Highlands` và `Highland (MMZ)` không bị
  nhân đôi. Dữ liệu trên máy đã cài tự nâng cấp offline từ cache ở lần mở kế tiếp. (`39c42e8`)

## [1.4.2] — 2026-08-23

### Sửa

- **Hotkey mở bản đồ khi cửa sổ bị game che**: bản đồ lớn nằm sau game (borderless
  fullscreen) vẫn được Windows coi là "đang hiện", nên bấm hotkey lần đầu bị hiểu
  ngược thành đóng bản đồ — thấy "nháy" một cái và phải bấm lần hai mới mở được.
  Giờ chỉ khi bản đồ lớn thực sự ở foreground (bạn đang nhìn nó) hotkey mới đóng;
  bị che hoặc thu nhỏ thì bấm một lần là mở lên ngay. (`b1f15c6`)

## [1.4.1] — 2026-08-23

### Thêm

- **Hotkey mở bản đồ tự về tab Bản đồ**: bấm Ctrl+Alt+F trong game để hiện cửa
  sổ là app chuyển ngay sang tab Bản đồ, không dừng ở tab đang mở dở; mở từ
  icon khay hoặc chạy lần hai vẫn giữ tab cũ. (`75cef13`)
- **Mục "Lớp bản đồ" thu gọn được**: bấm tiêu đề (mũi tên xoay + chữ Thu
  gọn/Mở rộng) để gập danh sách lớp — thấy ngay đường đã đi, vị trí, waypoint
  bên dưới không phải cuộn; trạng thái được nhớ qua các phiên. (`75cef13`)

## [1.4.0] — 2026-08-23

### Thêm

- **Đăng nhập Steam 1 lần cho mọi server IslePilot** (khuyên dùng): đăng nhập
  qua islepilot.eu duy nhất một lần, token dùng chung cho mọi server — hết cảnh
  nhập link server + copy cookie mỗi lần đổi server. Token lưu mã hóa DPAPI;
  redirect được bắt ngay trong cửa sổ đăng nhập (không đăng ký protocol hệ
  thống, không đụng app overlay gốc nếu có cài); có ô dán token thủ công làm
  lối thoát. Chế độ mới đọc API JSON thay vì scrape HTML: thêm **thể lực, dinh
  dưỡng Carb/Đạm/Béo, tên server đang chơi, giới tính** trong tab Khủng long.
  Cách cũ nhập server + cookie giữ nguyên làm dự phòng, người dùng cũ không
  phải làm lại gì. (`b8cff31`)
- **Tab Garage (Gacha)** — cần đăng nhập token: mỗi dino đã park là một card
  gồm **model 3D xoay/phóng được, đúng màu skin đã park** + tên/loài/growth +
  nút Park/Restore/Đổi tên/Bán (Bán chỉ hiện khi server bật; có hộp xác nhận).
  Model + texture tải từ CDN công khai của IslePilot (21 loài), cache trên đĩa
  — lần đầu mỗi loài tải vài MB có hiện tiến trình, các lần sau mở tức thì và
  offline được. Danh sách tự làm mới mỗi 10 phút khi tab đang mở (có dòng
  trạng thái), server không hỗ trợ garage thì báo rõ thay vì nút chết.
  (`63b4caf`, `2044c5f`)
- **Lớp bản đồ "POI server (IslePilot)"**: vẽ POI sống do admin server đặt
  (Sanctuaries, Migration/Patrol Zones…) lên bản đồ lớn, màu theo server, tự
  làm mới ~15 giây; cần đăng nhập token, thiếu quyền (link Discord/server tắt
  live map) thì hiện lý do trong bảng lớp. (`5bbb840`)
- **Thanh Thể lực trên minimap**: dải chỉ số dưới đĩa thêm hàng ⚡ khi có dữ
  liệu (chế độ token); cửa sổ overlay tự cao thêm đúng một hàng. (`f60d567`)
- **Icon cho thanh tab + tab Ủng hộ riêng**: 6 tab đều có icon; QR VietQR
  chuyển từ popup Footer thành tab Ủng hộ cạnh Hướng dẫn. (`69dbf51`)
- **Protocol `theisle-overlay://`**: bấm link `theisle-overlay://?sid=..&token=..`
  từ bất kỳ đâu là mở app và đăng nhập luôn — cố ý không dùng scheme
  `isle-overlay://` để không tranh với app gốc. (`aa9aa8e`)

### Sửa

- **Minimap "tự bỏ tích" rồi bật lại không hiện, phải mở lại app** — hai lỗi
  thực địa: (1) Windows tự lặp hotkey khi giữ tổ hợp làm toggle đảo ngược tức
  thì → thêm debounce 350 ms cho các phím bật/tắt (phím chỉnh độ đậm/zoom vẫn
  lặp như chủ đích); (2) cửa sổ minimap chết (WebView2 crash) thì supervisor
  trước đây lặp vô hạn không làm gì — giờ tự phát hiện và dựng lại trong ~5
  giây. (`6265364`)

### Thay đổi

- **Hướng dẫn kết nối IslePilot viết lại**: 2 cách rõ ràng — Đăng nhập Steam
  qua IslePilot (khuyên dùng) và cách cũ server + cookie (dự phòng); bỏ mục
  giải thích hướng đi và câu "giữ bí mật chuỗi như mật khẩu". (`f7d7818`)
- Tab Khủng long và Garage được giữ sống sau lần mở đầu (chuyển tab không còn
  khựng); model 3D chỉ dựng lại khi đổi loài/màu, tạm ngừng render khi khuất
  màn hình. (`2044c5f`)

## [1.3.0] — 2026-08-22

### Thêm

- **Bảng nhiệm vụ Prime trên overlay**: panel mới dưới thanh chỉ số của bản đồ
  nhỏ, liệt kê 10 nhiệm vụ Prime kèm ✓/○ và bộ đếm "Prime 2/10"; nhiệm vụ xong
  tô xanh, dòng dài tự cắt "…". Bật/tắt bằng checkbox trong tab Khủng long hoặc
  **hotkey Ctrl+Alt+Q** (đổi được trong Cài đặt); cửa sổ overlay tự co giãn
  theo số nhiệm vụ, mất mạng tạm thời không làm panel co giật. (`ec5da8a`)
- **Dịch nhiệm vụ sang tiếng Việt**: từ điển dịch tay cho toàn bộ pool nhiệm
  vụ đã biết + mẫu theo số ("Visit 3 Patrol zones" → "Ghé 3 khu Tuần tra");
  câu lạ dịch qua API miễn phí MyMemory **đúng một lần** rồi lưu vĩnh viễn tại
  `%LOCALAPPDATA%\TheIsleOverlay\quest_translations.json` (hết quota tự nghỉ
  6 giờ và hiện tiếng Anh; UI tiếng Anh bỏ qua API hoàn toàn). Tab Khủng long
  hiện câu tiếng Việt, rê chuột thấy câu gốc tiếng Anh. (`ec5da8a`)

### Thay đổi

- **Vị trí từ IslePilot chính xác hơn**: đọc thẳng JSON markers API của panel
  (`/api/p/{slug}/map/markers` — đúng nguồn panel tự dùng, tọa độ UE cm chuẩn
  xác, không sợ panel đổi giao diện), tự nhận marker của bạn qua steamId trong
  cookie phiên; trang HTML `/map` giữ làm nguồn dự phòng và để dò khả năng
  live map. (`ec5da8a`)

## [1.2.0] — 2026-08-22

### Thêm

- **Mũi tên dẫn đường waypoint trên minimap**: mũi tên ở rìa đĩa chỉ hướng +
  khoảng cách tới waypoint gần nhất khi nó nằm ngoài vùng nhìn; waypoint trong
  vùng nhìn hiện thành chấm (viền trắng, khác chấm POI viền đen). Có công tắc
  riêng trong Cài đặt › Bản đồ nhỏ.
- **Chế độ bám vị trí + mũi tên mép** trên bản đồ lớn: kéo bản đồ đi nơi khác
  là tạm ngừng tự căn giữa, mũi tên ở mép màn hình chỉ về phía bạn — bấm mũi
  tên hoặc nút "Về vị trí của tôi" để quay lại và bám tiếp.
- **Ô tìm kiếm địa danh** trên bảng phải tab Bản đồ: gõ tên vùng/địa
  điểm/hồ nước/waypoint → nhảy tới kèm hiệu ứng nhấp nháy đánh dấu.
- **Dán tọa độ → nhảy tới**: dán chuỗi tọa độ (bạn bè nhắn qua chat) vào ô tìm
  kiếm — parse bằng đúng bộ đọc tọa độ của clipboard (thuần thao tác tay).
- **Màu + biểu tượng cho waypoint**: nút tròn màu cạnh mỗi waypoint (bấm để
  đổi qua 7 màu, đồng bộ cả minimap); hộp đặt tên có sẵn nút biểu tượng nhanh
  💀 🏠 💧 ⚠️ 🍖 — waypoint mang biểu tượng thì **hiện thẳng biểu tượng đó
  trên cả hai bản đồ** thay cho chấm tròn, và nhãn mũi tên dẫn đường cũng kèm
  biểu tượng ("💧 850 m").

- **Lớp "Động vật"**: ~340 điểm spawn động vật AI (Boar, Bunny, Chicken, Crab,
  Deer, Frog, Goat, Teno, Turtle) từ dữ liệu cộng đồng của islemaps.com — bật
  trong bảng lớp của bản đồ lớn, hiện trên cả minimap, dùng được với mọi kiểu
  nền. **Mỗi loài một biểu tượng riêng** (🐗 🐰 🐔 🦀 🦌 🐸 🐐 🦕 🐢) để nhận
  ra ngay không cần rê chuột. Nguồn tải runtime và fail-soft như mọi nguồn
  khác: trang đổi cấu trúc thì lớp tạm vắng, không ảnh hưởng gì còn lại
  (POIS_VERSION 3).
- **Lớp "Nước ngọt"**: lớp phủ tô đúng các sông/hồ uống được (từ islemaps.com),
  căn chỉnh chính xác trên CẢ ba kiểu nền nhờ quy đổi khung tọa độ phía Rust;
  hiện trên cả bản đồ lớn lẫn minimap, bật/tắt trong bảng lớp.
- **Nút "Xóa đường đi"** trong bảng bên phải tab Bản đồ: xóa vết phiên hiện
  tại + ẩn vết phiên trước trên CẢ HAI cửa sổ cho đỡ rối mắt giữa trận; file
  lịch sử trên đĩa vẫn giữ nguyên (có ghi mốc ngắt).
- **Toggle "Hiện đường đi trên bản đồ nhỏ"** trong Cài đặt › Bản đồ nhỏ — tắt
  là minimap sạch vết, bản đồ lớn vẫn hiện đủ.
- **Lựa chọn nền bản đồ** trong Cài đặt: Vulnona (mặc định) / IsleMaps sáng /
  IsleMaps tối — nền vẽ tay từ [islemaps.com](https://www.islemaps.com/) (Pont
  & Emeara), áp dụng đồng thời cho bản đồ lớn lẫn minimap. Bản IsleMaps vẽ theo
  phiên bản game mới hơn nên thấy cả quần đảo đông nam (Hell's Mouth) mà ảnh
  Vulnona 0.21.7 cắt mất. Ảnh chỉ tải khi bạn chọn lần đầu (~6,4 / 4,5 MB, có
  kiểm tra toàn vẹn kích thước), sau đó dùng offline; nút "Tải lại dữ liệu"
  refresh có điều kiện qua ETag. Waypoint/trail giữ nguyên vì mọi tọa độ lưu
  bằng cm gốc của game; mỗi nền có calibration riêng nhúng sẵn kèm bộ test
  anchor, và `verify_data --source` đối chiếu điểm POI với ảnh nền cho cả 3
  nguồn.

### Thay đổi

- Hình học bản đồ (kích thước ảnh, khung zoom) giờ lấy động từ Rust
  (`get_map_info`) thay vì hằng số 7800×7817 phía frontend; khung zoom neo theo
  tỉ lệ mặt đất nên mức phóng to/thu nhỏ thực tế giữ nguyên trên mọi nền.
- Minimap nạp ảnh IsleMaps có thu nhỏ lúc decode (bitmap thường trú ~6 MB thay
  vì ~25 MB) và giải phóng bitmap cũ ngay khi đổi nền.

## [1.1.1] — 2026-08-21

### Sửa

- **Minimap ẩn khi Alt-Tab ra ngoài game**: game chạy borderless vẫn "visible"
  phía sau các app khác nên gate theo sự-tồn-tại khiến minimap lơ lửng đè lên
  Chrome/desktop — giờ gate theo cửa sổ foreground, có debounce ~0,5 giây chống
  nhấp nháy, quay lại game là hiện ngay. (`c45ecf8`)
- **Cài mới xong minimap không hiện trong game**: quy tắc "ẩn khi bản đồ lớn
  đang mở" kiểm tra WS_VISIBLE, mà cửa sổ chính nằm SAU game vẫn tính là
  visible → chặn nhầm minimap tới khi người dùng tự ẩn cửa sổ chính. Giờ chỉ
  chặn khi cửa sổ chính thực sự ở foreground. (`4409e87`)

### Thay đổi

- Bản đồ lần đầu mở chỉ bật lớp **Tên vùng** — các lớp POI khác tắt sẵn cho
  sạch, bật lại một chạm trong bảng lớp; lựa chọn đã lưu của người dùng cũ
  không bị ảnh hưởng. (`6f06035`)

## [1.1.0] — 2026-08-21

### Thêm

- **Icon khay hệ thống (system tray)** với menu Hiện cửa sổ / Thoát (song ngữ, đổi theo ngôn ngữ app). Nút X giờ thu app về khay như Steam/Discord thay vì hủy cửa sổ; chuột trái icon để mở lại. (`ccdb70c`)
- **Minimap chỉ hiện khi game đang chạy** — cài đặt mới "Chỉ hiện khi game đang chạy" (mặc định bật). Game thu nhỏ là minimap ẩn trong ~0,25 giây, tắt game là ẩn trong ~2,5 giây, mở game lại là tự hiện đúng góc đã neo. (`ccdb70c`)
- **Tam giác vàng đánh dấu vị trí của bạn** trên cả minimap lẫn bản đồ lớn — viền kép đen-trắng, xoay theo hướng di chuyển; khi chưa rõ hướng hiện đĩa vàng. Không thể nhầm với waypoint hay chấm POI nữa. (`518992d`)
- **Hotkey cứu hộ Ctrl+Alt+R**: tải lại giao diện cả hai cửa sổ — là phím tắt toàn cục nên hoạt động kể cả khi UI không nhận click; vị trí/trail tự khôi phục sau reload. (`cc0eb13`)
- **Footer** hiện phiên bản app + gợi ý "Nhấn F5 hoặc Ctrl+Alt+R để tải lại" ở góc trái dưới. (`518992d`, `cc0eb13`)
- **Tab Khủng long**: khu cài đặt server + cookie tự thu gọn sau khi đăng nhập (nút ⚙ để mở lại — hết cảnh phải cuộn mới thấy chỉ số). App tự dò server có live map hay không: có thì mặc định bật "lấy vị trí tự động" (vẫn tắt được, và lựa chọn tay của bạn luôn được tôn trọng), không có thì tự tắt và khóa ô tích, kèm dòng trạng thái ngay dưới. (`990dae9`)
- Lệnh `get_current_position`: mở lại cửa sổ hoặc F5 là vị trí + trail hiện ngay, không phải chờ lần copy tọa độ kế tiếp. (`ccdb70c`, `518992d`)
- Ghi log lỗi giao diện toàn cục vào file log (`%LOCALAPPDATA%\TheIsleOverlay\logs`) và log mọi lần ẩn/hiện cửa sổ — báo lỗi thực địa giờ tự chỉ đích danh nguyên nhân. (`518992d`, `462c67a`)
- Hướng dẫn kết nối tab Khủng long từng bước (Steam login / dán cookie, kèm ảnh minh họa) trong tab Hướng dẫn của app và cả hai README, cùng danh sách server IslePilot tham khảo. (`5e40555`)

### Sửa

- **Hotkey "chết hẳn" phải End Task**: message queue của thread hotkey giờ được tạo trước khi công bố thread id (WM_QUIT từng bị nuốt khiến thread mồ côi giữ toàn bộ phím); dừng thread cũ có chờ (join) trước khi đăng ký lại nên đổi phím không còn làm mất hết hotkey; đăng ký có retry; hành động chạy trên worker riêng nên vòng bơm message không bao giờ bị chặn. (`ccdb70c`)
- **Đơ tab / UI không nhận click**: nhiều lớp — watchdog tự phát hiện và hồi webview bị treo (`ccdb70c`), cú hích `NotifyParentWindowPositionChanged` tái đồng bộ luồng chuột sau mỗi lần hiện (`462c67a`), và loại bỏ tận gốc ở mục Thay đổi bên dưới (`a999133`).
- **Minimap nuốt click của chính app**: đĩa minimap (luôn-trên-cùng) đè lên cửa sổ chính sẽ nuốt click vùng nó che khi tắt click-xuyên → minimap giờ tự ẩn khi bản đồ lớn đang mở và tự hiện lại khi đóng. (`cc0eb13`)
- **Poller IslePilot chết vĩnh viễn** khi phiên hết hạn hoặc site đổi giao diện (hai trường hợp không phân biệt được): giờ cảnh báo một lần, poll chậm dần (backoff lũy tiến, trần 5 phút) và tự hồi khi đọc được trở lại. (`ccdb70c`)
- Mở app từ icon khay từng hiện trang cũ do thiếu bước đồng bộ. (`462c67a`)
- Chuyển tab nhanh làm rò rỉ listener sự kiện; F5 giờ giữ nguyên tab đang mở; lỗi Leaflet được cách ly khỏi thanh tab (có nút Thử lại). (`518992d`)
- Sample tọa độ đầu tiên sau khi khởi động từng bị mất; minimap giờ luôn được giám sát kể cả khi webview khởi tạo lỗi (fallback 5 giây). (`ccdb70c`)
- Cookie hợp lệ nhưng **chưa có dino trên server** từng bị từ chối oan là "cookie
  không hợp lệ" (trang /me chỉ ghi "No dino" nên không có chỉ số để parse) — cả 3
  đường dán cookie / đăng nhập Steam / cảnh báo hết-phiên của poller giờ xác thực
  bằng dấu hiệu phiên đăng nhập thật của panel, không phụ thuộc chỉ số dino. Link
  server thừa dấu `/` cuối cũng được chuẩn hóa. (`16c26a1`)
- Sửa lỗi biên dịch CI: trùng module test, chữ ký `IsSuspended`. (`bf7e5e2`)

### Thay đổi

- **Gỡ hoàn toàn cơ chế đóng băng webview (TrySuspend)** — thao tác bất đồng bộ bên trong WebView2 này là gốc của mọi biến thể "cửa sổ hiện mà click chết" (3 sự cố thực địa một ngày). Thay bằng gợi ý dọn cache đồng bộ (`MemoryUsageTargetLevel` LOW khi ẩn / NORMAL khi hiện); sự kiện broadcast tới cả cửa sổ ẩn nên hiện lại là đúng ngay. Đánh đổi: app ẩn/ngồi khay nặng thêm ~80 MB — đổi lấy độ tin cậy tuyệt đối giữa trận. Watchdog giữ lại làm lính canh. (`a999133`, đảo ngược `4a2f3c7`)
- Mọi mutex dùng khóa chống-poisoning (`lock_safe`) — một panic lẻ ở thread nào đó không còn kéo sập clipboard, supervisor và hotkey cùng lúc. (`ccdb70c`)
- Kiểm tra ẩn/hiện cửa sổ qua registry HWND (`IsWindowVisible`/`IsIconic` — đọc tức thời) thay cho getter chặn-luồng của tauri; luồng bơm hotkey không còn phụ thuộc main loop. (`ccdb70c`)
- Nâng phiên bản 1.1.0. (`6357f40`)

## [1.0.1] — 2026-08-19

### Sửa

- Spam Ctrl+Alt+F nhanh không còn làm treo cửa sổ (thêm độ trễ ổn định + token hủy cho cơ chế đóng băng webview). (`2cb6f44`)

### Tài liệu

- Thêm ảnh chụp trong game và toàn bản đồ vào README; thêm mục liên hệ/ủng hộ. (`a6ea77e`, `2cb6f44`)

## [1.0.0] — 2026-08-19

Bản viết lại toàn bộ bằng Tauri (Rust + WebView2) từ app PySide6 gốc — giữ nguyên định dạng cài đặt/waypoint/trail nên dữ liệu cũ dùng lại được ngay. (`ffb2126`)

### Thêm

- Nhãn tên vùng/địa danh trên bản đồ và các lớp bật/tắt mới. (`1b40416`)
- Tab "Khủng long của bạn": đọc chỉ số dino (growth, máu, đói, khát, Prime) từ panel IslePilot của server, đăng nhập Steam qua webview hoặc dán cookie. (`9ea7a90`)
- Footer ghi công tác giả với liên kết GitHub/Facebook và popup ủng hộ VietQR. (`19e4dd2`)
- README song ngữ Việt/Anh. (`859f061`)

### Sửa

- Dữ liệu tải lần đầu tới thẳng minimap không cần khởi động lại; các tab dùng được ngay trong lúc tải. (`3f1bff7`)
- Ctrl+Alt+F khôi phục được bản đồ lớn từ trạng thái thu nhỏ. (`f8988fe`)

### Hiệu năng

- Đóng băng cửa sổ ẩn để giải phóng RAM renderer. (`4a2f3c7` — *đã gỡ ở 1.1.0 vì gây lỗi treo, xem phần Thay đổi của 1.1.0*)
