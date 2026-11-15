# Dapur Calc

Offline-first Progressive Web App (PWA) untuk memilih kombinasi dapur paling cuan dari pesan grup WhatsApp, menghitung topup bandar, dan membuat balasan grup dengan tag nama otomatis.

## Fitur

- **Parsing otomatis chat WhatsApp**: mendukung spasi tidak beraturan, nama tanpa spasi (`=24/11vivi`), hari bahasa Indonesia (`=rabu`, `=jum'at`), prefix ekspor WhatsApp, mengabaikan `Cancel`, `Rekapan PO`, dan laporan cair.
- **Optimasi tepat (0/1 Knapsack DP)**: memaksimalkan profit/hari (atau total profit) sesuai kapasitas `Uang gue + Saldo bandar`, dengan tie-breaker total profit, modal terpakai, dan jumlah dapur.
- **Balasan grup presisi**: menyisipkan tag (`vivi`) hanya pada baris yang dipilih tanpa mengubah baris lain, emoji, atau baris kosong.
- **100% Offline & Privat**: tanpa backend, tanpa analytics, semua data tersimpan lokal di `localStorage`.

## Cara Menjalankan Lokal

Clipboard API dan Service Worker membutuhkan *secure context* (`http://localhost` atau `https://`).

Menggunakan Node.js:
```bash
npx serve .
```

Atau menggunakan Python:
```bash
python -m http.server 8080
```
Lalu buka `http://localhost:8080` di browser.

## Cara Menjalankan Unit Test

```bash
node --test tests/dapur-calc.test.js
```

## Cara Deploy Gratis (HTTPS)

1. **GitHub Pages**: Push folder ini ke repository GitHub, lalu aktifkan **Settings → Pages → Deploy from branch (`main` / root)**.
2. **Netlify**: Drag-and-drop folder ini ke [app.netlify.com/drop](https://app.netlify.com/drop).
3. **Cloudflare Pages**: Hubungkan repo GitHub di Cloudflare Pages tanpa build command (output directory `.`).
