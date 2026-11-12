# Nâng cấp pi-web lên phiên bản mới (giữ tiếng Việt)

Cây nguồn: `~/pi-web-src` · nhánh làm việc: `feat/vietnamese-i18n`
Remote: `origin` = fork `github.com/tooltd/pi-web` · `upstream` = `github.com/agegr/pi-web`
Các commit riêng của ta: gói `vi.ts` + patch vào 7 file i18n/web-push.
Mọi thứ còn lại là của upstream, **không sửa** để rebase còn sạch.

## Vì sao phải làm theo thứ tự này

`scripts/run` không có. `pi-web.service` chạy **trực tiếp** từ
`~/pi-web-src/bin/pi-web.js`, nên cây nguồn vừa là code vừa là bản đang chạy:
`git checkout` bừa là sập web đang dùng.

Và tuyệt đối **không** `systemctl --user stop/restart pi-web` trực tiếp trong lúc
session pi đang chạy bên trong nó — lệnh đó tự giết chính agent đang deploy
(đã xảy ra một lần, exit 143). Xem mục "Deploy an toàn" bên dưới.

## Quy trình 6 bước

```bash
cd ~/pi-web-src

# 1. Lấy bản mới (chưa động vào working tree)
git fetch upstream --depth 1 tag vX.Y.Z
git log --oneline -1 vX.Y.Z

# 2. Xem upstream có đụng file ta đã patch không
git diff --stat HEAD vX.Y.Z -- \
  lib/i18n/registry.ts lib/i18n/types.ts lib/i18n/format.ts \
  hooks/useI18n.tsx lib/web-push.ts app/api/push/subscribe/route.ts \
  lib/i18n/registry.test.mjs

# 3. Rebase phần của ta lên bản mới
git rebase vX.Y.Z            # hoặc: git merge vX.Y.Z nếu thích merge commit
#    Xung đột thường gặp: lib/i18n/registry.ts (dòng localePlugins) và
#    lib/i18n/registry.test.mjs (mảng getSupportedLocales). Giữ CẢ upstream lẫn "vi".

# 4. Đồng bộ gói dịch
node scripts/i18n-vi-sync.mjs          # xem báo cáo
#    → key MỚI: dịch rồi thêm vào scripts/i18n-vi-translations.json
#    → key BỊ XOÁ: để --write tự dọn
#    → placeholder lệch: LỖI, phải sửa tay (nếu không UI hiện {tên-biến} thô)
node scripts/i18n-vi-sync.mjs --write  # ghi lại vi.ts theo thứ tự key của en.ts
node scripts/i18n-vi-sync.mjs          # phải ra 0 key mới, 0 lệch

# 5. Kiểm chứng
npm install                           # chỉ khi package.json đổi
node_modules/.bin/tsc --noEmit
npm run lint
node --experimental-strip-types --test lib/i18n/registry.test.mjs
npm run build                         # next build --webpack, ~5 phút

# 6. Deploy (xem dưới)
```

`npm run build` ghi `.next/` ngay trong cây nguồn. Vì service đang chạy từ đó,
**build xong mới được restart**; trong lúc build, web vẫn phục vụ bằng `.next` cũ
nên không sao, chỉ đừng restart giữa chừng.

## Deploy an toàn (không tự giết session)

Chạy lệnh này để nó tách khỏi session hiện tại rồi mới restart:

```bash
systemd-run --user --collect --unit=pi-web-restart-$(date +%s) \
  systemctl --user restart pi-web.service
```

Kiểm tra sau ~10 giây:

```bash
systemctl --user is-active pi-web.service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30141/login   # 200
journalctl --user -u pi-web.service -n 30 --no-pager | tail -20
```

Kiểm tra tiếng Việt thật sự có trong bundle:

```bash
CHUNK=$(grep -rl 'Tiếng Việt' .next/static/chunks/*.js | head -1)
curl -s "http://127.0.0.1:30141/_next/static/chunks/$(basename "$CHUNK")" | grep -c 'Tiếng Việt'
```

Nếu 0: `.next` chưa được build lại, hoặc đang chạy bản khác — kiểm tra
`systemctl --user show pi-web.service -p ExecStart --value`.

## Rollback

```bash
cd ~/pi-web-src
git reset --hard vX.Y.Z~0        # về đúng tag upstream, mất bản dịch
# hoặc lùi 1 commit bản dịch:
git reset --hard HEAD~1
npm run build
systemd-run --user --collect systemctl --user restart pi-web.service
```

Bản đã push vẫn còn trên fork, khôi phục bằng `git reset --hard origin/feat/vietnamese-i18n`.

Bản `.next` cũ vẫn nằm ở `~/pi-web/node_modules/@agegr/pi-web/.next` (package npm
0.15.0, không có tiếng Việt) nếu cần chạy lại bản gốc: đổi `ExecStart` về
`~/pi-web/node_modules/.bin/pi-web`.

## Những gì thuộc về ta (đừng để mất)

| File | Thay đổi |
|---|---|
| `lib/i18n/messages/vi.ts` | 1756 key (0.15.0) → 1771 key (0.16.0) |
| `scripts/i18n-vi-sync.mjs` | công cụ đồng bộ |
| `scripts/i18n-vi-translations.json` | bản dịch tay cho key mới |
| `lib/i18n/registry.ts` | import + thêm `viLocale` vào mảng |
| `lib/i18n/types.ts` | `Locale` union thêm `"vi"` |
| `lib/i18n/format.ts` | `vi` trong `SHORT_TIME_UNITS` |
| `hooks/useI18n.tsx` | nhận `stored === "vi"` |
| `lib/web-push.ts` | payload push tiếng Việt |
| `app/api/push/subscribe/route.ts` | nhận locale `vi` |
| `lib/i18n/registry.test.mjs` | test nhận diện `vi` |

## Nếu upstream tự thêm tiếng Việt

Kiểm tra trước khi rebase:

```bash
git ls-tree vX.Y.Z lib/i18n/messages/ | grep -o 'vi\.ts'
```

Nếu có, bản của ta thành thừa: bỏ commit bản dịch, `git rebase --skip` các
commit đó, chỉ giữ `scripts/` nếu còn hữu ích.

## Giới hạn đã biết

- `debug.*` (197 key) và phần lớn `mcp.*` do model dịch: đọc được nhưng đôi chỗ
  còn cứng. Sửa bằng cách thêm key vào `scripts/i18n-vi-translations.json` rồi
  chạy `node scripts/i18n-vi-sync.mjs --write`.
- `files.conflictSummary` bỏ `{countSuffix}` có chủ đích (tiếng Việt không chia
  số nhiều); test và script đều đã whitelist key này.
- Đã push: `origin` = `github.com/tooltd/pi-web`, nhánh `feat/vietnamese-i18n`
  (fork của `agegr/pi-web`). Push tiếp bằng `git push` là đủ.
- Không mở pull request về `agegr/pi-web` trừ khi muốn đóng góp bản dịch lên upstream.
