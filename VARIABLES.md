# Template Variables

Variabel-variabel ini bisa dipakai di pesan template seperti `setwelcome`, `setgoodbye`, `setclose`, dsb.

Semua variabel **case-insensitive** — `@user`, `@User`, `@USER` semuanya valid.

---

## Variabel Pengguna

| Variabel | Keterangan | Contoh Output |
|----------|-----------|---------------|
| `@user` | Mention user (tanpa @, hanya nomor) | `@6281234567890` |
| `@tag` | Sama seperti `@user`, tapi lebih eksplisit untuk mention | `@6281234567890` |
| `@name` | Nama tampilan (pushname) pengguna | `user` |

---

## Variabel Grup

| Variabel | Keterangan | Contoh Output |
|----------|-----------|---------------|
| `@group` | Nama grup | `Grup Keluarga` |
| `@groupName` | Alias dari `@group` | `Grup Keluarga` |
| `@groupId` | JID grup | `1234567890@g.us` |
| `@totalMembers` | Total anggota grup | `42` |
| `@adminCount` | Jumlah admin grup | `3` |
| `@adminList` | Daftar admin (diformat teks) | `Admin1, Admin2` |
| `@announce` | Status pengumuman grup (on/off) | `on` |
| `@restrict` | Status pembatasan grup (on/off) | `off` |
| `@creationDate` | Tanggal grup dibuat | `01-01-2023` |

---

## Variabel Waktu

| Variabel | Keterangan | Contoh Output |
|----------|-----------|---------------|
| `@time` | Waktu saat ini (format 24 jam, locale ID) | `14:30:00` |
| `@date` | Tanggal hari ini (format DD-MM-YYYY) | `31-05-2026` |
| `@greeting` | Sapaan sesuai waktu | `Pagi` / `Siang` / `Sore` / `Malam` |

---

## Variabel Khusus

| Variabel | Keterangan | Dipakai di |
|----------|-----------|------------|
| `{prefix}` | Prefix bot aktif di grup | Menu, help message |
| `@broadcastMsg` | Isi pesan broadcast | Fitur broadcast |

---

## Contoh Penggunaan

```
.setwelcome Selamat datang @user di *@group*! 👋
Sekarang ada *@totalMembers* anggota. Waktu: @time (@greeting)
```

**Output:**
```
Selamat datang @6281234567890 di *Grup Keluarga*! 👋
Sekarang ada *42* anggota. Waktu: 14:30:00 (Siang)
```

---

## Menambah Variabel Baru

Semua logika penggantian variabel ada di [`src/utils/helpers.ts`](src/utils/helpers.ts) di fungsi `replaceVariables`.

Langkah-langkah menambah variabel baru:

1. **Tambah ke parameter `vars`** di fungsi `replaceVariables`:
   ```ts
   vars: {
       // ... variabel yang sudah ada ...
       namaVariabel?: string;
   }
   ```

2. **Tambah `.replace()`** di chain:
   ```ts
   .replace(/@namaVariabel/gi, vars.namaVariabel || '')
   ```

3. **Pass nilainya** saat memanggil `replaceVariables()`:
   ```ts
   replaceVariables(template, {
       user: `@${userNumber}`,
       groupName,
       namaVariabel: 'nilai',
   });
   ```

4. **Update file ini** dengan dokumentasi variabel baru.
