/* =====================================================================
   laporanData.js — helper bersama halaman laporan KotaKita
   Dipakai oleh: laporanTerkonfirmasi.js, detailLaporan.js, laporan.js,
                 rekamLaporan.js
   Pasang SETELAH supabase-js + supabaseClient.js dan SEBELUM script halaman.

   Sumber data:
     - daftar publik      → RPC  laporan_publik(p_limit)      (sudah dipakai dashboard)
     - laporan milik user → tabel laporan_jalan (RLS: baris milik sendiri)
     - detail per kode    → RPC  laporan_detail(p_kode)       (sql/baca-laporan.sql)
                            cadangan: tabel laporan_jalan, lalu laporan_publik
   Script klasik (bukan ES module) agar jalan dari file:// maupun server statis.
   Diekspos sebagai window.KKL.
   ===================================================================== */
(function () {
    'use strict';

    const HALAMAN_LOGIN = 'login.html';
    const HALAMAN_DETAIL = 'detailLaporan.html';
    const TABEL = 'laporan_jalan';
    const TZ = 'Asia/Jakarta';

    /* ---------- Status ----------
       Nilai di database (kolom status) → tampilan.
       Upload memakai 'menunggu' (tampil "Terkirim"). */
    const STATUS = {
        sent:       { key: 'sent',       label: 'Terkirim' },
        verified:   { key: 'verified',   label: 'Diverifikasi' },
        processing: { key: 'processing', label: 'Diproses' },
        completed:  { key: 'completed',  label: 'Selesai' },
        rejected:   { key: 'rejected',   label: 'Ditolak' }
    };
    const ALIAS = {
        menunggu: 'sent', terkirim: 'sent', baru: 'sent',
        diverifikasi: 'verified', terverifikasi: 'verified', dikonfirmasi: 'verified',
        diproses: 'processing', proses: 'processing', dikerjakan: 'processing',
        selesai: 'completed',
        ditolak: 'rejected'
    };

    function statusInfo(s) {
        const k = String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, '_');
        return STATUS[ALIAS[k] || 'sent'];
    }

    /* ---------- Helper umum ---------- */
    const angka = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
    const koordinatOk = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

    const urlAman = u => (/^https?:\/\//i.test(u || '') ? String(u) : '');

    const FOTO_KOSONG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#8aa3cc"/></svg>');

    function el(tag, kelas, teks) {
        const e = document.createElement(tag);
        if (kelas) e.className = kelas;
        if (teks != null) e.textContent = teks;
        return e;
    }

    const huruf1 = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

    function tanggal(iso) {
        const d = iso ? new Date(iso) : null;
        if (!d || isNaN(d)) return '';
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
    }

    function tanggalWaktu(iso) {
        const d = iso ? new Date(iso) : null;
        if (!d || isNaN(d)) return '';
        const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
        return tanggal(iso) + ', ' + jam.replace('.', ':');
    }

    const linkDetail = kode => (kode ? `${HALAMAN_DETAIL}?kode=${encodeURIComponent(kode)}` : '#');

    /* ---------- Alamat ----------
       uploadLaporan.js menyimpan "utama, kelurahan, kecamatan, kota"
       (atau hanya "lat, lon" bila alamat tidak ditemukan). */
    function pecahAlamat(alamat, lat, lng) {
        const a = String(alamat || '').trim();
        if (!a) {
            return {
                utama: koordinatOk(lat, lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Lokasi tidak diketahui',
                rinci: ''
            };
        }
        if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(a)) return { utama: a, rinci: '' };
        const i = a.indexOf(',');
        return i < 0 ? { utama: a, rinci: '' } : { utama: a.slice(0, i).trim(), rinci: a.slice(i + 1).trim() };
    }

    /* ---------- Normalisasi satu baris laporan ---------- */
    function normalisasi(r, uid) {
        const lat = angka(r.lokasi_lat != null ? r.lokasi_lat : r.latitude);
        const lng = angka(r.lokasi_lng != null ? r.lokasi_lng : r.longitude);
        const jml = angka(r.jumlah_pelapor != null ? r.jumlah_pelapor : r.jumlah_laporan);
        const pemilikDiketahui = r.milik_saya !== undefined || r.user_id !== undefined;
        return {
            raw: r,
            kode: r.kode ? String(r.kode) : '',
            kategori: r.kategori ? String(r.kategori) : 'Kerusakan Jalan',
            tingkat: ['ringan', 'sedang', 'parah'].includes(r.tingkat) ? r.tingkat : '',
            deskripsi: r.deskripsi ? String(r.deskripsi) : '',
            alamat: pecahAlamat(r.alamat, lat, lng),
            lat, lng,
            foto: urlAman(r.foto_url),
            dibuat: r.created_at || r.dibuat_pada || r.tanggal || null,
            tsVerifikasi: r.diverifikasi_at || r.verified_at || null,
            tsProses: r.diproses_at || r.processed_at || null,
            tsSelesai: r.selesai_at || r.completed_at || null,
            st: statusInfo(r.status),
            pelapor: Number.isFinite(jml) && jml > 0 ? Math.round(jml) : null,
            username: r.username || r.nama_pengguna || '',
            catatan: String(r.catatan_petugas || r.catatan || r.alasan_penolakan || '').trim(),
            pemilikDiketahui,
            milik: r.milik_saya === true || (!!uid && r.user_id === uid)
        };
    }

    const waktuUrut = n => { const t = n.dibuat ? Date.parse(n.dibuat) : NaN; return Number.isFinite(t) ? t : 0; };
    const terbaruDulu = (a, b) => waktuUrut(b) - waktuUrut(a);

    /* ---------- Judul alamat ringkas ---------- */
    const segmen1 = rinci => String(rinci || '').split(',')[0].trim();

    // "Jl. Dipatiukur No. 45 • Lebakgede • 12 September 2026" (bullet pakai span.bullet)
    function isiMeta(wadah, n) {
        const bagian = [n.alamat.utama, segmen1(n.alamat.rinci), tanggal(n.dibuat)].filter(Boolean);
        const w = document.createElement('span');
        bagian.forEach((b, i) => {
            if (i) {
                w.append(' ');
                w.append(el('span', 'bullet', '•'));
                w.append(' ');
            }
            w.append(document.createTextNode(b));
        });
        wadah.textContent = '';
        wadah.append(w);
    }

    /* ---------- Tahapan status (timeline) ---------- */
    function langkah(n) {
        const k = n.st.key;
        const kini = k === 'sent' ? 0 : (k === 'verified' || k === 'rejected') ? 1 : k === 'processing' ? 2 : 3;
        const judul = ['Laporan terkirim', k === 'rejected' ? 'Ditolak admin' : 'Diverifikasi admin', 'Diproses petugas', 'Selesai'];
        const ts = [n.dibuat, n.tsVerifikasi, n.tsProses, n.tsSelesai];
        const menunggu = ['', 'Menunggu verifikasi admin · +15 poin saat dikonfirmasi', 'Menunggu penanganan petugas', 'Menunggu penyelesaian · +25 poin saat selesai'];

        return judul.map((j, i) => {
            const keadaan = i < kini ? 'lewat' : i === kini ? 'kini' : 'nanti';
            let w = ts[i] ? tanggalWaktu(ts[i]) : '';
            if (keadaan === 'kini' && i === 2) w = (w ? w + ' · ' : '') + 'sedang berjalan';
            if (!w) {
                if (keadaan === 'lewat') w = 'Tahap selesai';
                else if (keadaan === 'nanti') w = k === 'rejected' ? 'Tidak dilanjutkan' : menunggu[i];
                else w = i === 0 ? 'Laporan diterima'
                    : i === 1 ? (k === 'rejected' ? 'Laporan tidak memenuhi syarat' : 'Sedang diverifikasi')
                    : 'Masalah telah ditangani';
            }
            return { judul: j, waktu: w, keadaan };
        });
    }

    /* ---------- Pesan galat ---------- */
    function pesanGalat(err) {
        const m = String((err && err.message) || '').toLowerCase();
        const kode = String((err && (err.code || err.statusCode)) || '');
        if (kode === 'PGRST202' || kode === '42883')
            return 'Fungsi database belum dibuat. Jalankan sql/baca-laporan.sql di Supabase.';
        if (kode === 'PGRST205' || kode === '42P01')
            return `Tabel "${TABEL}" belum ada. Jalankan sql/setup-laporan-baru.sql di Supabase.`;
        if (kode === '42501' || m.includes('row-level security') || m.includes('permission denied'))
            return 'Akses ditolak oleh kebijakan database. Jalankan sql/baca-laporan.sql di Supabase dan pastikan Anda masih login.';
        if (m.includes('jwt') || m.includes('expired')) return 'Sesi login berakhir. Silakan masuk kembali.';
        if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.';
        return 'Gagal memuat laporan: ' + ((err && err.message) || 'terjadi kesalahan.');
    }

    const fungsiTidakAda = err => !!err && (err.code === 'PGRST202' || err.code === '42883');

    /* ---------- Akses data ---------- */
    async function ambilPublik(limit, uid) {
        const { data, error } = await db.rpc('laporan_publik', { p_limit: limit || 100 });
        if (error) throw error;
        return (data || []).map(r => normalisasi(r, uid));
    }

    async function ambilMilikSaya(uid) {
        // select('*') supaya tidak gagal bila nama kolom opsional (created_at, dst.) berbeda
        const { data, error } = await db.from(TABEL).select('*').eq('user_id', uid);
        if (error) throw error;
        return (data || []).map(r => normalisasi(r, uid)).sort(terbaruDulu);
    }

    // Mengembalikan laporan ter-normalisasi, atau null bila kode tidak ditemukan.
    async function ambilDetail(kode, uid) {
        if (!kode) return null;
        let galat = null;

        // 1) RPC khusus detail (aman untuk laporan milik pengguna lain)
        try {
            const { data, error } = await db.rpc('laporan_detail', { p_kode: kode });
            if (error) { if (!fungsiTidakAda(error)) galat = error; }
            else {
                const baris = Array.isArray(data) ? data[0] : data;
                if (baris && typeof baris === 'object') return normalisasi(baris, uid);
                return null;                                   // fungsi ada, kode tidak ditemukan
            }
        } catch (e) { galat = galat || e; }

        // 2) cadangan: tabel (hanya baris milik sendiri yang lolos RLS)
        try {
            const { data, error } = await db.from(TABEL).select('*').eq('kode', kode).limit(1);
            if (error) galat = galat || error;
            else if (data && data[0]) return normalisasi(data[0], uid);
        } catch (e) { galat = galat || e; }

        // 3) cadangan terakhir: daftar publik
        try {
            const { data, error } = await db.rpc('laporan_publik', { p_limit: 500 });
            if (error) galat = galat || error;
            else {
                const baris = (data || []).find(r => String(r.kode) === String(kode));
                if (baris) return normalisasi(baris, uid);
                galat = null;                                  // daftar terbaca, kode memang tidak ada
            }
        } catch (e) { galat = galat || e; }

        if (galat) throw galat;
        return null;
    }

    /* ---------- Sesi & tampilan ---------- */
    const bukaTampilan = () => { const g = document.getElementById('kk-guard'); if (g) g.remove(); };
    setTimeout(bukaTampilan, 4000);                             // jaring pengaman

    // Mengembalikan sesi, atau null (halaman dialihkan ke login).
    async function pastikanLogin() {
        if (!window.db || !window.KK) { bukaTampilan(); return null; }
        const sesi = await window.KK.ambilSesi();
        if (!sesi) { window.location.replace(HALAMAN_LOGIN); return null; }
        db.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.replace(HALAMAN_LOGIN); });
        return sesi;
    }

    window.KKL = Object.freeze({
        STATUS, statusInfo, angka, koordinatOk, urlAman, FOTO_KOSONG, el, huruf1,
        tanggal, tanggalWaktu, linkDetail, pecahAlamat, normalisasi, terbaruDulu,
        segmen1, isiMeta, langkah, pesanGalat,
        ambilPublik, ambilMilikSaya, ambilDetail,
        pastikanLogin, buka: bukaTampilan
    });
})();
