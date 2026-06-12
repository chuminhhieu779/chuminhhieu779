# 📊 IELTS Stats README — Build Plan

Auto-sync IELTS progress từ youpass.vn lên GitHub profile README, chạy hoàn toàn trên GitHub Actions, không cần server.

---

## 🎯 Goal

Mỗi ngày README tự động hiển thị stats mới nhất từ youpass.vn theo dạng:

```text
📖 Reading
             Correct   Wrong  Skipped   Total  Progress
─────────────────────────────────────────────────────────────────
Passage 1        275     132        9     416  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀⣀   66.11%
Passage 2        180      60       10     250  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀   72.00%
Passage 3        116      74       10     200  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀   58.00%
```

---

## 🗂️ File Structure

```
midori-suzune/               ← GitHub profile repo
├── README.md                ← có 2 comment tag placeholder
├── scripts/
│   └── update-ielts.js      ← script chính fetch API + ghi README
└── .github/
    └── workflows/
        └── update-ielts.yml ← GitHub Actions workflow
```

---

## 🔧 Tech Stack

| Thành phần | Công nghệ | Lý do |
|---|---|---|
| Runtime | Node.js | built-in GitHub Actions |
| HTTP client | `node-fetch` hoặc native `fetch` (Node 18+) | không cần cài thêm |
| File I/O | Node.js `fs` | đọc ghi README.md |
| Scheduler | GitHub Actions cron | free, không cần server |
| Auth | GitHub Secrets | lưu token youpass an toàn |

---

## 📡 API

**Endpoint:** `https://api.youpass.vn/v1/answers/statistics`

| Param | Value |
|---|---|
| `skill_id` | 1 = Reading, 2 = Listening, 3 = Writing, 4 = Speaking |
| `type` | 3 = theo passage/section |
| `sort` | `passage.asc` |
| `page_size` | 100 |

**Response mẫu:**
```json
{
  "data": {
    "items": [
      {
        "passage": 1,
        "total": 416,
        "success": 275,
        "failed": 132,
        "skipped": 9,
        "correct_percent": 66.11
      }
    ]
  }
}
```

---

## 🪜 Build Steps

### Step 1 — Chuẩn bị repo
- [ ] Tạo profile repo `midori-suzune/midori-suzune` (nếu chưa có)
- [ ] Thêm 2 tag vào `README.md` đúng chỗ muốn hiển thị:
```markdown
<!-- YOUPASS:START -->
<!-- YOUPASS:END -->
```

### Step 2 — Lấy token youpass
- [ ] Mở youpass.vn → DevTools (F12) → tab Network
- [ ] Filter `Fetch/XHR` → tìm request tới `api.youpass.vn`
- [ ] Xem tab Headers → copy giá trị `Authorization` hoặc `Cookie`

### Step 3 — Lưu token vào GitHub Secrets
- [ ] Vào repo → Settings → Secrets and variables → Actions
- [ ] Tạo secret tên `YOUPASS_TOKEN`
- [ ] Paste token vào

### Step 4 — Viết script `scripts/update-ielts.js`
- [ ] Fetch API tất cả skills (Reading, Listening, Writing, Speaking)
- [ ] Build text block theo format đã chốt (monospace, ⣿⣀ bar)
- [ ] Đọc README.md hiện tại
- [ ] Replace nội dung giữa 2 tag `YOUPASS:START` và `YOUPASS:END`
- [ ] Ghi lại file README.md

### Step 5 — Viết workflow `.github/workflows/update-ielts.yml`
- [ ] Trigger: `schedule` cron mỗi ngày + `workflow_dispatch` (chạy thủ công)
- [ ] Steps: checkout → setup Node → run script → commit & push

### Step 6 — Test
- [ ] Chạy thủ công lần đầu qua tab Actions → Run workflow
- [ ] Kiểm tra README đã update chưa
- [ ] Verify format hiển thị đúng trên GitHub profile

---

## ⏱️ Schedule

```yaml
# Chạy mỗi ngày 00:00 UTC = 07:00 sáng giờ Việt Nam
- cron: "0 0 * * *"
```

---

## ⚠️ Lưu ý

- **Token youpass có thể hết hạn** → cần update lại GitHub Secret nếu action báo lỗi 401
- **Commit chỉ xảy ra khi data thay đổi** → dùng `git diff --quiet` để tránh commit rỗng
- **Thêm `[skip ci]` vào commit message** → tránh trigger lại action vô tận

---

## 🚀 Next

Sau khi chạy ổn, có thể mở rộng:
- Thêm skill Speaking nếu youpass có data
- Hiển thị overall score tổng hợp
- So sánh với tuần trước (lưu snapshot vào file JSON)
