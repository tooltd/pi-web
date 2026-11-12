#!/usr/bin/env node
/**
 * Đồng bộ gói tiếng Việt với en.ts sau khi cập nhật pi-web lên phiên bản mới.
 *
 *   node scripts/i18n-vi-sync.mjs            # báo cáo
 *   node scripts/i18n-vi-sync.mjs --write     # thêm key thiếu (giá trị = tiếng Anh), xoá key thừa
 *
 * Bản dịch tay cho các key mới đặt trong scripts/i18n-vi-translations.json
 * (dạng { "key": "bản dịch" }). Script tự áp dụng file này mỗi lần chạy,
 * nên việc update chỉ còn: chạy script → dịch các key còn báo TODO → chạy lại.
 *
 * Việc cần làm sau khi chạy --write:
 *   1. Dịch các key được đánh dấu TODO (chúng đang tạm để tiếng Anh).
 *   2. Soát các key bị đổi nội dung tiếng Anh (script liệt kê ra).
 *   3. node --experimental-strip-types --test lib/i18n/registry.test.mjs
 *
 * Không cần chạm vào gì khác: registry.ts, types.ts, format.ts, useI18n.tsx,
 * web-push.ts và route push là patch riêng, rebase bình thường là xong.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EN = path.join(root, "lib/i18n/messages/en.ts");
const VI = path.join(root, "lib/i18n/messages/vi.ts");
const TRANSLATIONS = path.join(root, "scripts/i18n-vi-translations.json");

/** Bản dịch tay cho các key mới; file không bắt buộc. */
function readTranslations() {
  if (!fs.existsSync(TRANSLATIONS)) return {};
  try {
    return JSON.parse(fs.readFileSync(TRANSLATIONS, "utf8"));
  } catch (error) {
    console.error(`Không đọc được ${path.relative(root, TRANSLATIONS)}: ${error.message}`);
    process.exit(1);
  }
}

/** Đọc một file locale thành Map giữ nguyên thứ tự key. */
function readMessages(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = new Map();
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) {
    out.set(m[1], m[2]);
  }
  return { src, out };
}

/** So sánh hai chuỗi đã escape để biết nội dung tiếng Anh có đổi không. */
const unescape = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const placeholders = (s) => [...s.matchAll(/\{([\w.-]+)\}/g)].map((m) => m[1]).sort().join(",");

// Tiếng Việt không có dạng số nhiều, nên {countSuffix} ("file"/"files") được bỏ
// có chủ đích. Giữ danh sách này đồng bộ với optionalPlaceholders trong
// lib/i18n/registry.test.mjs.
const OPTIONAL_PLACEHOLDERS = { "files.conflictSummary": ["countSuffix"] };
const required = (key, msg) => {
  const skip = OPTIONAL_PLACEHOLDERS[key] ?? [];
  return [...msg.matchAll(/\{([\w.-]+)\}/g)].map((m) => m[1]).filter((n) => !skip.includes(n)).sort().join(",");
};
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const en = readMessages(EN).out;
const { src: viSrc, out: vi } = readMessages(VI);
const manual = readTranslations();

// Áp dụng bản dịch tay trước khi so sánh, để key vừa dịch không bị báo thiếu.
// Giá trị trong file JSON là văn bản thô, nên phải escape như khi ghi ra .ts.
for (const [key, value] of Object.entries(manual)) {
  if (en.has(key) && typeof value === "string" && value.trim()) vi.set(key, esc(value));
}

const added = [...en.keys()].filter((k) => !vi.has(k));
const removed = [...vi.keys()].filter((k) => !en.has(k));
const retranslated = [...en.keys()].filter((k) => vi.has(k) && required(k, en.get(k)) !== required(k, vi.get(k)));
const identical = [...en.keys()].filter((k) => vi.has(k) && vi.get(k) === en.get(k) && /[a-z]{4,}/i.test(en.get(k)));

console.log(`en.ts: ${en.size} key · vi.ts: ${vi.size} key\n`);
console.log(`Key MỚI cần dịch:        ${added.length}`);
for (const k of added) console.log(`  + ${k}  ${JSON.stringify(unescape(en.get(k)))}`);
console.log(`\nKey BỊ XOÁ (phải gỡ):     ${removed.length}`);
for (const k of removed) console.log(`  - ${k}`);
console.log(`\nPlaceholder lệch (LỖI):   ${retranslated.length}`);
for (const k of retranslated) console.log(`  ! ${k}: en=${required(k, en.get(k))} vi=${required(k, vi.get(k))}`);
console.log(`\nCòn nguyên tiếng Anh:     ${identical.length}`);
for (const k of identical.slice(0, 20)) console.log(`  ? ${k}  ${JSON.stringify(unescape(en.get(k)))}`);
if (identical.length > 20) console.log(`  … và ${identical.length - 20} key nữa`);

if (retranslated.length > 0) {
  console.error("\nPlaceholder lệch làm hỏng giao diện (biến không được thay). Sửa tay trước khi build.");
  process.exitCode = 1;
}

if (!process.argv.includes("--write")) {
  console.log("\nChạy lại với --write để thêm key mới và gỡ key thừa.");
  process.exit();
}

// Giữ nguyên header + thứ tự khai báo của en.ts để diff về sau còn đọc được.
const lines = [...en.keys()].map((k) => {
  const value = vi.has(k) ? vi.get(k) : esc(unescape(en.get(k)));
  return `    ${JSON.stringify(k)}: "${value}",`;
});
const header = viSrc.slice(0, viSrc.indexOf("  messages: {") + "  messages: {".length);
const out = `${header}\n${lines.join("\n")}\n  },\n};\n`;
fs.writeFileSync(VI, out);

console.log(`\nĐã ghi vi.ts: +${added.length} key (tạm tiếng Anh), -${removed.length} key.`);
console.log("Giờ dịch các key có tiền tố mới rồi chạy test.");
