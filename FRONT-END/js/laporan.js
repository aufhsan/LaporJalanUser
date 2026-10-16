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
    const AMBIL = 100;                 // jumlah laporan yang diminta dari database
    const TINGGI_MIN = 1230;           // tinggi .page awal (px)
    const BARIS_Y = 658, BARIS_TINGGI = 139, RUANG_BAWAH = 90;

    const $ = id => document.getElementById(id);
    const wadah = $('daftarLaporan');
    const halaman = $('halamanLaporan');
    const kartu = Array.from(document.querySelectorAll('.popular-card'));
    const filterBtn = Array.from(document.querySelectorAll('.filter[data-filter]'));

    const state = { semua: [], filter: 'all', siap: false };

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
        const populer = pilihPopuler(state.semua.slice());
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
        const daftar = state.filter === 'all'
            ? state.semua
            : state.semua.filter(n => n.st.key === state.filter);

        if (!daftar.length) {
            pesan(state.filter === 'all'
                ? 'Belum ada laporan.'
                : `Belum ada laporan dengan status ${K.STATUS[state.filter].label}.`);
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
    })();
})();
