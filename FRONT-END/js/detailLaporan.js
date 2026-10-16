/* =====================================================================
   detailLaporan.js — detailLaporan.html?kode=...
     - ambil laporan dari Supabase berdasarkan ?kode=
     - tampilkan foto, status, alamat, jumlah pelapor, jenis masalah,
       tahapan status, dan deskripsi
     - peta Leaflet (OpenStreetMap) dengan pin di titik laporan
   Butuh: Leaflet, window.db, window.KK (supabaseClient.js), window.KKL (laporanData.js)
   ===================================================================== */
(function () {
    'use strict';

    const K = window.KKL;
    const ZOOM_TITIK = 17;
    const $ = id => document.getElementById(id);

    const E = {
        foto: $('dFoto'), caption: $('dFotoCaption'), tanggal: $('dFotoTanggal'),
        badge: $('dBadge'),
        peta: $('petaDetail'), alamat: $('dAlamat'), alamatRinci: $('dAlamatRinci'),
        pelapor: $('dPelapor'), jenis: $('dJenis'),
        langkah: Array.from({ length: 4 }, (_, i) => ({
            dot: $('stDot' + (i + 1)), judul: $('stJudul' + (i + 1)), waktu: $('stWaktu' + (i + 1))
        })),
        deskripsi: $('dDeskripsi'), pesan: $('dPesan'), kembali: $('dKembali')
    };

    /* ---------- Tombol kembali: ikut halaman asal ---------- */
    function aturKembali() {
        const ref = document.referrer || '';
        if (/rekamLaporan/i.test(ref)) E.kembali.href = 'rekamLaporan.html';
        else if (/dashboard/i.test(ref)) E.kembali.href = 'dashboard.html';
        else E.kembali.href = 'laporan.html';
    }

    /* ---------- Keadaan galat ---------- */
    function tampilGalat(teks) {
        E.pesan.textContent = teks;
        E.pesan.hidden = false;
        E.foto.hidden = true;
        E.caption.textContent = '';
        E.tanggal.textContent = '';
        E.badge.hidden = true;
        E.alamat.textContent = '—';
        E.alamatRinci.textContent = '';
        E.pelapor.textContent = '—';
        E.jenis.textContent = '—';
        E.deskripsi.textContent = '—';
        E.langkah.forEach(l => { l.judul.textContent = ''; l.waktu.textContent = ''; l.dot.hidden = true; });
        E.peta.textContent = '';
        E.peta.classList.add('map--kosong');
    }

    /* ---------- Peta ---------- */
    function gambarPeta(n) {
        if (!K.koordinatOk(n.lat, n.lng)) {
            E.peta.classList.add('map--kosong');
            E.peta.textContent = 'Koordinat lokasi tidak tersedia.';
            return;
        }
        if (!window.L) {
            E.peta.classList.add('map--kosong');
            E.peta.textContent = 'Peta gagal dimuat (Leaflet). Periksa koneksi internet lalu muat ulang.';
            return;
        }

        E.peta.textContent = '';
        E.peta.classList.remove('map--kosong');

        const peta = L.map(E.peta, { scrollWheelZoom: false }).setView([n.lat, n.lng], ZOOM_TITIK);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        }).addTo(peta);

        const ikon = L.divIcon({
            className: 'kk-pin',
            html: '<svg viewBox="0 0 24 32" width="34" height="46" aria-hidden="true">'
                + '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" '
                + 'fill="#092e6d" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>',
            iconSize: [34, 46], iconAnchor: [17, 46]
        });
        L.marker([n.lat, n.lng], { icon: ikon, title: n.alamat.utama, keyboard: false }).addTo(peta);

        if ('ResizeObserver' in window) new ResizeObserver(() => peta.invalidateSize()).observe(E.peta);
        setTimeout(() => peta.invalidateSize(), 0);
    }

    /* ---------- Tampilkan data ---------- */
    function tampil(n) {
        document.title = `Detail Laporan ${n.kode} — KotaKita`;
        E.pesan.hidden = true;

        // foto
        if (n.foto) {
            E.foto.onerror = () => { E.foto.hidden = true; };
            E.foto.src = n.foto;
            E.foto.alt = `Foto ${n.kategori.toLowerCase()} di ${n.alamat.utama}`;
            E.foto.hidden = false;
        } else {
            E.foto.hidden = true;
        }
        E.caption.textContent = n.milik ? 'Foto oleh Anda'
            : n.username ? 'Foto oleh @' + String(n.username).replace(/^@/, '')
            : 'Foto oleh warga';
        E.tanggal.textContent = K.tanggalWaktu(n.dibuat);

        // status
        E.badge.textContent = n.st.label;
        E.badge.className = 'process-badge s-' + n.st.key;
        E.badge.hidden = false;

        // lokasi
        E.alamat.textContent = n.alamat.utama;
        E.alamatRinci.textContent = n.alamat.rinci;
        gambarPeta(n);

        // pelapor
        E.pelapor.textContent = '';
        E.pelapor.append('Sudah ada ');
        E.pelapor.append(K.el('strong', null, `${n.pelapor || 1} pelapor`));
        E.pelapor.append(' untuk isu ini');

        // jenis masalah (+ tingkat)
        E.jenis.textContent = n.kategori + (n.tingkat ? ' • Tingkat ' + n.tingkat : '');

        // tahapan status
        K.langkah(n).forEach((l, i) => {
            const v = E.langkah[i];
            v.judul.textContent = l.judul;
            v.waktu.textContent = l.waktu;
            v.dot.hidden = false;
            v.dot.className = 'status-dot' + (l.keadaan === 'lewat' ? ' faded' : l.keadaan === 'nanti' ? ' pending' : '');
            v.judul.classList.toggle('muted', l.keadaan === 'lewat');
            v.waktu.classList.toggle('muted', l.keadaan === 'lewat');
        });

        // deskripsi (+ catatan petugas / alasan penolakan bila ada)
        E.deskripsi.textContent = n.deskripsi || 'Tidak ada deskripsi.';
        if (n.catatan) {
            E.deskripsi.append(document.createElement('br'));
            E.deskripsi.append(K.el('strong', null,
                (n.st.key === 'rejected' ? 'Alasan penolakan: ' : 'Catatan petugas: ')));
            E.deskripsi.append(n.catatan);
        }
    }

    /* ---------- Init ---------- */
    (async function init() {
        aturKembali();

        if (!K || !window.db || !window.KK) {
            const g = document.getElementById('kk-guard'); if (g) g.remove();
            tampilGalat('Supabase belum dimuat. Periksa tag <script> di detailLaporan.html.');
            return;
        }

        const sesi = await K.pastikanLogin();
        if (!sesi) return;
        K.buka();

        const kode = (new URLSearchParams(window.location.search).get('kode') || '').trim();
        if (!kode) {
            tampilGalat('Kode laporan tidak ada di alamat halaman. Pilih laporan dari daftar Laporan.');
            return;
        }

        try {
            const n = await K.ambilDetail(kode, sesi.user.id);
            if (!n) { tampilGalat(`Laporan dengan kode ${kode} tidak ditemukan.`); return; }
            tampil(n);
        } catch (err) {
            console.error('[detailLaporan]', err);
            tampilGalat(K.pesanGalat(err));
        }
    })();
})();
