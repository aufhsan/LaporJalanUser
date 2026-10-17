/* =====================================================================
   laporan.js — laporan.html
     - "Laporan Terpopuler": 3 laporan teratas (jumlah pelapor bila tersedia,
       selain itu yang terbaru)
     - daftar laporan dari Supabase (RPC laporan_publik) + filter status
     - tiap kartu/baris membuka detailLaporan.html?kode=...
   Butuh: window.db, window.KK (supabaseClient.js), window.KKL (laporanData.js)
   ===================================================================== */
(function () {
    'use strict';

    const K = window.KKL;
    const R = window.KKR;              // radiusLokasi.js (opsional)
    const AMBIL = 100;                 // jumlah laporan yang diminta dari database
    const TINGGI_MIN = 1230;           // tinggi .page awal (px)
    const BARIS_Y = 658, BARIS_TINGGI = 139, RUANG_BAWAH = 90;

    const $ = id => document.getElementById(id);
    const wadah = $('daftarLaporan');
    const halaman = $('halamanLaporan');
    const kartu = Array.from(document.querySelectorAll('.popular-card'));
    const filterBtn = Array.from(document.querySelectorAll('.filter[data-filter]'));

    const state = { semua: [], filter: 'all', siap: false, radius: null, pusat: null, pakaiRadius: true, chip: null };

    /* ---------- Radius lokasi laporan (diatur di Profil → Akun) ---------- */
    const radiusBerlaku = () => !!(R && state.pakaiRadius && state.radius && state.pusat);
    function dalamArea(n) {
        if (!radiusBerlaku()) return true;
        return K.koordinatOk(n.lat, n.lng) && R.dalamRadius(state.pusat, [n.lat, n.lng], state.radius);
    }
    const sumber = () => state.semua.filter(dalamArea);

    function perbaruiChip() {
        const b = state.chip;
        if (!b) return;
        if (!R || !state.radius || !state.pusat) { b.hidden = true; return; }
        b.hidden = false;
        b.textContent = `Radius ${state.radius} km: ${state.pakaiRadius ? 'Aktif' : 'Nonaktif'}`;
        b.setAttribute('aria-pressed', state.pakaiRadius ? 'true' : 'false');
        b.title = state.pakaiRadius ? 'Klik untuk menampilkan laporan dari semua area' : 'Klik untuk membatasi laporan sesuai radius';
        b.classList.toggle('kk-radius-chip--off', !state.pakaiRadius);
    }

    function pasangChip() {
        const st = document.createElement('style');
        st.textContent = `
          .kk-radius-chip { position: absolute; left: 360px; top: 164px; height: 36px; padding: 0 16px;
            border-radius: 99px; background: #092e6d; color: #fff; font: 600 14px "Inter", sans-serif; cursor: pointer; z-index: 5; }
          .kk-radius-chip--off { background: transparent; color: #092e6d; box-shadow: inset 0 0 0 2px #092e6d; }
          @media (max-width: 767px) { .kk-radius-chip { position: static; justify-self: start; height: 30px; font-size: 12px; margin: 0 2px; } }`;
        document.head.append(st);
        const b = K.el('button', 'kk-radius-chip');
        b.type = 'button';
        b.hidden = true;
        b.addEventListener('click', () => {
            state.pakaiRadius = !state.pakaiRadius;
            perbaruiChip();
            if (state.siap) { renderPopuler(); renderDaftar(); }
        });
        if (halaman) halaman.append(b);
        state.chip = b;
    }

    /* ---------- Tampilan ---------- */
    function aturTinggi(jumlahBaris) {
        if (!halaman) return;
        halaman.style.height = Math.max(TINGGI_MIN, BARIS_Y + jumlahBaris * BARIS_TINGGI + RUANG_BAWAH) + 'px';
    }

    function pesan(teks, galat) {
        wadah.textContent = '';
        wadah.append(K.el('p', 'kk-kosong' + (galat ? ' kk-kosong--err' : ''), teks));
        aturTinggi(1);
    }

    function judulKartu(n) {
        const s1 = K.segmen1(n.alamat.rinci);
        return s1 ? `${n.alamat.utama}, ${s1}` : n.alamat.utama;
    }

    /* ---------- Laporan Terpopuler ---------- */
    function pilihPopuler(semua) {
        return semua
            .filter(n => n.st.key !== 'rejected')
            .sort((a, b) => ((b.pelapor || 0) - (a.pelapor || 0)) || K.terbaruDulu(a, b))
            .slice(0, kartu.length);
    }

    function renderPopuler() {
        const populer = pilihPopuler(sumber());
        kartu.forEach((k, i) => {
            const n = populer[i];
            k.hidden = !n;
            if (!n) return;
            k.href = K.linkDetail(n.kode);
            const img = k.querySelector('.popular-image');
            img.onerror = () => { img.onerror = null; img.src = K.FOTO_KOSONG; };
            img.src = n.foto || K.FOTO_KOSONG;
            img.alt = `${n.kategori} di ${n.alamat.utama}`;
            k.querySelector('.popular-card-title').textContent = judulKartu(n);
            k.querySelector('.popular-card-desc').textContent =
                `${n.kategori} • ${n.pelapor ? n.pelapor + ' Pelapor' : n.st.label}`;
        });
    }

    /* ---------- Daftar laporan ---------- */
    function buatBaris(n) {
        const a = K.el('a', 'report');
        a.href = K.linkDetail(n.kode);

        const foto = K.el('span', 'photo-placeholder');
        const ikon = K.el('span', 'photo-icon');
        ikon.setAttribute('aria-hidden', 'true');
        foto.append(ikon);
        if (n.foto) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = () => { img.remove(); foto.classList.remove('ada-foto'); };
            img.src = n.foto;
            foto.append(img);
            foto.classList.add('ada-foto');
        }

        const alamat = K.el('span', 'report-address');
        K.isiMeta(alamat, n);

        const arrow = K.el('span', 'report-arrow');
        arrow.setAttribute('aria-hidden', 'true');

        a.append(
            foto,
            K.el('span', 'report-title', n.kategori),
            alamat,
            K.el('span', 'badge ' + n.st.key),
            K.el('span', 'badge-label ' + n.st.key + '-text', n.st.label),
            K.el('span', 'detail-label', 'Lihat Detail'),
            arrow
        );
        return a;
    }

    function renderDaftar() {
        if (!state.siap) return;
        const dasar = sumber();
        const daftar = state.filter === 'all'
            ? dasar
            : dasar.filter(n => n.st.key === state.filter);

        if (!daftar.length) {
            const radiusTxt = radiusBerlaku() ? ` dalam radius ${state.radius} km` : '';
            pesan(state.filter === 'all'
                ? `Belum ada laporan${radiusTxt}.`
                : `Belum ada laporan dengan status ${K.STATUS[state.filter].label}${radiusTxt}.`);
            return;
        }
        wadah.textContent = '';
        const frag = document.createDocumentFragment();
        daftar.forEach(n => frag.append(buatBaris(n)));
        wadah.append(frag);
        aturTinggi(daftar.length);
    }

    function setFilter(nilai) {
        state.filter = nilai;
        filterBtn.forEach(b => {
            const aktif = b.dataset.filter === nilai;
            b.classList.toggle('active', aktif);
            b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
        });
        renderDaftar();
    }

    /* ---------- Data ---------- */
    async function muat(uid) {
        pesan('Memuat laporan…');
        kartu.forEach(k => { k.hidden = true; });
        try {
            state.semua = (await K.ambilPublik(AMBIL, uid)).sort(K.terbaruDulu);
            state.siap = true;
            renderPopuler();
            renderDaftar();
        } catch (err) {
            console.error('[laporan]', err);
            pesan(K.pesanGalat(err), true);
        }
    }

    /* ---------- Init ---------- */
    (async function init() {
        if (!K || !window.db || !window.KK || !wadah) {
            const g = document.getElementById('kk-guard'); if (g) g.remove();
            if (wadah) pesan('Supabase belum dimuat. Periksa tag <script> di laporan.html.', true);
            return;
        }

        const sesi = await K.pastikanLogin();
        if (!sesi) return;
        K.buka();

        filterBtn.forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));
        muat(sesi.user.id);

        if (R) {
            pasangChip();
            // radius dari profil + posisi pengguna; tidak memblokir tampilan awal
            Promise.all([R.muatRadius(sesi.user.id), R.posisiPengguna()]).then(([km, lokasi]) => {
                state.radius = km;
                state.pusat = lokasi.akurat ? lokasi.pos : null;   // tanpa lokasi nyata, radius tidak diterapkan
                perbaruiChip();
                if (state.siap) { renderPopuler(); renderDaftar(); }
            });
        }
    })();
})();
