# RepoFast — GitHub Repository Manager

> Upload Once. Organize Everything. Push to GitHub.

Upload satu ZIP berisi banyak file/folder ke GitHub dalam **satu commit**, kelola repository, jelajahi dan edit file — tanpa registrasi, tanpa database.

## Menjalankan lokal

```bash
npm run dev        # http://localhost:3000  (tanpa dependensi, hanya Node ≥ 18)
npm test           # 24 uji API (mock GitHub) 
node test/zip.test.js   # uji pembersih path ZIP (ZIP Slip)
npm run check      # syntax check seluruh file JS
```

Opsional: `npm i -g vercel && vercel dev` untuk meniru Vercel sepenuhnya.

## Deploy ke Vercel

1. Push folder ini ke GitHub, lalu **Import Project** di Vercel (framework: *Other*).
2. Tidak ada environment variable wajib. `vercel.json` sudah mengatur build (`dist/`), CSP, header keamanan, dan `maxDuration` fungsi.
3. Atau lewat CLI: `vercel --prod`.

## Model keamanan token (token hanya di perangkat)

- Token **tidak pernah disimpan di server/database/cookie/log**. Server bersifat *stateless*: token dikirim di header `Authorization` setiap request lewat HTTPS, diteruskan ke GitHub, lalu dilupakan.
- Di browser, token disimpan **terenkripsi (AES-GCM) di IndexedDB** dengan kunci `CryptoKey` *non-extractable* — bukan di localStorage, URL, atau DOM. Centang "Remember on this device" dimatikan → token hanya di memori tab.
- Setelah connect, kolom token dikosongkan. *Disconnect* menghapus token dan kunci seketika.
- Proteksi lain: validasi input di server, header `X-RepoFast-Client` + pemeriksaan `Origin` (CSRF), rate limit per-IP, CSP ketat, cegah ZIP Slip/path traversal, batas ukuran/jumlah file, redaksi token dari pesan error.
- Catatan jujur: penyimpanan di sisi browser tidak kebal terhadap XSS; CSP (`script-src 'self'`) dan tidak adanya script pihak ketiga mengurangi risikonya. Gunakan fine-grained token yang dibatasi ke repository tertentu.

> Penyimpangan dari PRD: PRD meminta cookie HttpOnly yang dikelola server, tetapi permintaan terakhir Anda adalah token hanya disimpan di perangkat. Maka dipakai model stateless di atas.

## Cara kerja upload

1. ZIP dibaca di browser (JSZip). Direktori pusat dibaca dulu; ukuran dideklarasikan dicek **sebelum** file di-inflate (anti decompression-bomb).
2. Manifest divalidasi server (`/api/upload/validate-zip`), konflik dicek (`/api/upload/process-zip`).
3. Blob dibuat bertahap (batch ≤ ~3 MB, 2 paralel, retry otomatis) → tree (dipecah per 1000 entri, dirantai `base_tree`) → **satu commit** → update branch (fast-forward, **tanpa force push**). Jika branch berubah di tengah jalan → pesan "Repository has changed".
4. Progres = operasi yang benar-benar selesai (bukan animasi palsu).

Batasan yang perlu diketahui:
- File yang terlalu besar untuk satu request serverless (> ~2,4 MB) dikirim **langsung dari browser ke api.github.com** dengan token yang sama (hanya jalur berbeda, tetap tidak disimpan). File > 50 MB dilewati (gunakan Git LFS).
- Repository **kosong** tidak menerima Git Database API: file pertama dikirim lewat Contents API sehingga terbentuk 2 commit (ditampilkan di layar sukses).
- Git tidak menyimpan folder kosong → "New folder" membuat `.gitkeep`.
- Endpoint `/api/upload/bulk-upload` (tree→commit→ref dalam satu panggilan) tersedia untuk skrip/klien lain; UI memakai endpoint terpisah agar progres akurat.

## Struktur

```
api/_lib/      http pipeline, GitHub client, validasi, commit flow
api/[...route].js   satu-satunya serverless function (batas Hobby: 12); api/_lib/router.js mendispatch ke api/_lib/routes/*
src/js/        app, router, github-client, upload-engine/manager, zip-manager, file-explorer, ...
src/css/       variables, layout, components, dashboard, responsive
public/        logo, favicon, vendor (jszip, highlight.js — di-bundel lokal)
test/          mock GitHub + uji API + uji ZIP
```

## Izin token

- **Fine-grained**: *Contents: Read and write*, *Metadata: Read*; tambah *Administration: Read and write* untuk membuat repository.
- **Classic**: scope `repo` saja.
