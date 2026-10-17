/* =====================================================================
   laporanTerkonfirmasi.js — laporanTerkonfirmasi.html
     - membaca ?kode=... (dikirim uploadLaporan.js setelah insert berhasil)
     - menampilkan kode + ringkasan laporan dari Supabase
     - tombol "Detail Laporan" → detailLaporan.html?kode=...
   Butuh: window.db, window.KK (supabaseClient.js), window.KKL (laporanData.js)
   ===================================================================== */
(function () {
    'use strict';

    const K = window.KKL;
    const $ = id => document.getElementById(id);
    const E = {
        ikon: $('ikonSukses'), judul: $('judulSukses'),
        kode: $('kodeLaporan'), ringkasan: $('ringkasanLaporan'),
        detail: $('btnDetail')
    };

    function tampilTanpaKode(judul, ringkasan) {
        E.ikon.hidden = true;
        E.judul.textContent = judul;
        E.kode.hidden = true;
        if (ringkasan) { E.ringkasan.textContent = ringkasan; E.ringkasan.hidden = false; }
        E.detail.textContent = 'Lihat Laporan Saya';
        E.detail.href = 'rekamLaporan.html';
    }

    function isiRingkasan(teks) {
        E.ringkasan.textContent = teks;
        E.ringkasan.hidden = !teks;
    }

    (async function init() {
        if (!K || !window.db || !window.KK) {
            const g = document.getElementById('kk-guard'); if (g) g.remove();
            return;
        }

        const sesi = await K.pastikanLogin();
        if (!sesi) return;
        K.buka();

        const kode = (new URLSearchParams(window.location.search).get('kode') || '').trim();
        if (!kode) {
            tampilTanpaKode('Kode laporan tidak ditemukan',
                'Alamat halaman ini tidak memuat kode laporan. Buka daftar laporan Anda untuk melihat laporan yang sudah dikirim.');
            return;
        }

        // Kode dari URL sudah pasti ada; tampilkan segera sebelum data selesai dimuat
        E.kode.textContent = 'Kode laporan: ' + kode;
        E.kode.hidden = false;
        E.detail.href = K.linkDetail(kode);

        try {
            const n = await K.ambilDetail(kode, sesi.user.id);

            // Tidak ada, atau ada tetapi milik orang lain → bukan laporan yang baru dikirim user ini
            if (!n || (n.pemilikDiketahui && !n.milik)) {
                tampilTanpaKode('Laporan tidak ditemukan',
                    `Laporan dengan kode ${kode} tidak ada di akun Anda.`);
                return;
            }

            const lokasi = [n.alamat.utama, n.alamat.rinci].filter(Boolean).join(', ');
            isiRingkasan(`${n.kategori}${n.tingkat ? ' (' + n.tingkat + ')' : ''} • ${lokasi} • ${n.st.label}`);
        } catch (err) {
            console.warn('[laporanTerkonfirmasi]', err);
            isiRingkasan('Ringkasan laporan belum dapat dimuat. Anda tetap dapat membuka detailnya.');
        }
    })();
})();
