/* =====================================================================
   rekamLaporan.js — rekamLaporan.html
     - wajib login; membaca laporan milik user dari tabel laporan_jalan
     - statistik (total / dikonfirmasi / selesai), filter status
     - klik baris → panel "Detail Laporan" (tahapan, catatan, tombol)
     - "Tarik Laporan" (hanya status Terkirim) dan "Unduh Riwayat (PDF)"
       (jendela cetak browser → Simpan sebagai PDF)
   Butuh: window.db, window.KK (supabaseClient.js), window.KKL (laporanData.js)
   ===================================================================== */
(function () {
    'use strict';

    const K = window.KKL;
    const TABEL = 'laporan_jalan';
    const BUCKET = 'foto_laporan';
    const KELAS_BADGE = { sent: 'sent', verified: 'verified-badge', processing: 'processing', completed: 'completed', rejected: 'rejected' };

    const $ = id => document.getElementById(id);
    const E = {
        daftar: $('daftarRekam'),
        statTotal: $('statTotal'), statKonfirmasi: $('statKonfirmasi'), statSelesai: $('statSelesai'),
        filter: Array.from(document.querySelectorAll('.filter[data-filter]')),
        unduh: $('btnUnduh'),
        judul: $('rkJudul'), meta: $('rkMeta'), isi: $('rkIsi'),
        langkah: Array.from({ length: 4 }, (_, i) => ({
            dot: $('rkDot' + (i + 1)), judul: $('rkT' + (i + 1)), waktu: $('rkW' + (i + 1))
        })),
        catatan: $('rkCatatan'), catatanJudul: $('rkCatatanJudul'), catatanTeks: $('rkCatatanTeks'),
        lihat: $('rkLihat'), tarik: $('rkTarik')
    };

    const state = { semua: [], filter: 'all', dipilih: '', uid: '', siap: false };
    const layarKecil = () => window.matchMedia('(max-width: 767px)').matches;
    const sembunyi = (elemen, ya) => elemen.classList.toggle('kk-sembunyi', !!ya);

    /* ---------- Statistik ---------- */
    function renderStat() {
        const hitung = (...kunci) => state.semua.filter(n => kunci.includes(n.st.key)).length;
        E.statTotal.textContent = state.siap ? state.semua.length : '–';
        E.statKonfirmasi.textContent = state.siap ? hitung('verified', 'processing', 'completed') : '–';
        E.statSelesai.textContent = state.siap ? hitung('completed') : '–';
    }

    /* ---------- Daftar ---------- */
    function pesan(teks, galat) {
        E.daftar.textContent = '';
        E.daftar.append(K.el('p', 'kk-kosong' + (galat ? ' kk-kosong--err' : ''), teks));
    }

    function buatBaris(n) {
        const a = K.el('a', 'report' + (n.kode === state.dipilih ? ' dipilih' : ''));
        a.href = K.linkDetail(n.kode);
        a.dataset.kode = n.kode;

        const foto = K.el('div', 'photo-placeholder');
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

        const meta = K.el('span', 'report-meta');
        K.isiMeta(meta, n);

        const badge = K.el('span', 'badge ' + KELAS_BADGE[n.st.key]);
        badge.append(K.el('span', null, n.st.label));

        const panah = K.el('span', 'arrow-icon');
        panah.setAttribute('aria-hidden', 'true');

        a.append(foto, K.el('span', 'report-title', n.kategori), meta, badge, panah);
        return a;
    }

    const tersaring = () => (state.filter === 'all'
        ? state.semua
        : state.semua.filter(n => n.st.key === state.filter));

    function render() {
        renderStat();
        if (!state.siap) return;

        const daftar = tersaring();
        if (!daftar.length) {
            state.dipilih = '';
            pesan(state.filter === 'all'
                ? 'Anda belum mengirim laporan.'
                : `Belum ada laporan dengan status ${K.STATUS[state.filter].label}.`);
            isiDetail(null);
            return;
        }

        if (!daftar.some(n => n.kode === state.dipilih)) state.dipilih = daftar[0].kode;

        E.daftar.textContent = '';
        const frag = document.createDocumentFragment();
        daftar.forEach(n => frag.append(buatBaris(n)));
        E.daftar.append(frag);
        isiDetail(daftar.find(n => n.kode === state.dipilih));
    }

    function pilih(kode) {
        state.dipilih = kode;
        E.daftar.querySelectorAll('.report').forEach(r => r.classList.toggle('dipilih', r.dataset.kode === kode));
        isiDetail(state.semua.find(n => n.kode === kode));
    }

    function setFilter(nilai) {
        state.filter = nilai;
        E.filter.forEach(b => {
            const aktif = b.dataset.filter === nilai;
            b.classList.toggle('active', aktif);
            b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
        });
        render();
    }

    /* ---------- Panel detail ---------- */
    function isiDetail(n) {
        sembunyi(E.isi, !n);
        if (!n) {
            E.judul.textContent = state.siap ? 'Belum ada laporan' : 'Memuat…';
            E.meta.textContent = '';
            return;
        }

        E.judul.textContent = n.kategori + (n.tingkat ? ' (' + n.tingkat + ')' : '');
        K.isiMeta(E.meta, n);

        K.langkah(n).forEach((l, i) => {
            const v = E.langkah[i];
            v.judul.textContent = l.judul;
            v.waktu.textContent = l.waktu;
            v.dot.classList.toggle('pending', l.keadaan === 'nanti');
        });

        sembunyi(E.catatan, !n.catatan);
        E.catatanJudul.textContent = n.st.key === 'rejected' ? 'Alasan penolakan:' : 'Catatan petugas:';
        E.catatanTeks.textContent = n.catatan;

        E.lihat.href = K.linkDetail(n.kode);
        sembunyi(E.tarik, n.st.key !== 'sent');       // hanya laporan yang belum diverifikasi
    }

    /* ---------- Tarik laporan ---------- */
    const pathFoto = url => {
        const m = String(url || '').match(new RegExp('/' + BUCKET + '/([^?]+)'));
        try { return m ? decodeURIComponent(m[1]) : ''; } catch (_) { return ''; }
    };

    async function tarik() {
        const n = state.semua.find(x => x.kode === state.dipilih);
        if (!n || n.st.key !== 'sent') return;
        if (!window.confirm('Tarik laporan ini? Laporan akan dihapus dan tidak dapat dikembalikan.')) return;

        E.tarik.disabled = true;
        try {
            const { data, error } = await db.from(TABEL).delete()
                .eq('kode', n.kode).eq('user_id', state.uid).select('kode');
            if (error) throw error;
            if (!data || !data.length) {
                window.alert('Laporan tidak dapat ditarik. Mungkin statusnya sudah berubah atau tidak diizinkan oleh database.');
                return;
            }
            const p = pathFoto(n.foto);                       // bersihkan foto (tanpa menggagalkan penarikan)
            if (p) { try { await db.storage.from(BUCKET).remove([p]); } catch (_) { /* abaikan */ } }

            state.semua = state.semua.filter(x => x.kode !== n.kode);
            state.dipilih = '';
            render();
        } catch (err) {
            console.error('[rekamLaporan] tarik:', err);
            const kode = String((err && err.code) || '');
            window.alert(kode === '42501'
                ? 'Laporan tidak dapat ditarik: izin hapus belum dibuat. Jalankan sql/baca-laporan.sql di Supabase.'
                : 'Gagal menarik laporan: ' + ((err && err.message) || 'terjadi kesalahan.'));
        } finally {
            E.tarik.disabled = false;
        }
    }

    /* ---------- Unduh riwayat (cetak → PDF) ---------- */
    const esc = s => String(s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function unduh() {
        if (!state.semua.length) { window.alert('Belum ada laporan untuk diunduh.'); return; }

        const baris = state.semua.map((n, i) => {
            const lokasi = [n.alamat.utama, n.alamat.rinci].filter(Boolean).join(', ');
            return `<tr><td>${i + 1}</td><td>${esc(n.kode)}</td><td>${esc(n.kategori)}</td>`
                + `<td>${esc(lokasi)}</td><td>${esc(K.tanggalWaktu(n.dibuat))}</td><td>${esc(n.st.label)}</td></tr>`;
        }).join('');

        const html = '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Riwayat Laporan KotaKita</title>'
            + '<style>body{font-family:Arial,Helvetica,sans-serif;color:#131b2e;margin:24px}'
            + 'h1{font-size:20px;margin:0 0 4px;color:#092e6d}p{margin:0 0 16px;font-size:12px;color:#555}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px}'
            + 'th,td{border:1px solid #b3c7ea;padding:6px 8px;text-align:left;vertical-align:top}'
            + 'th{background:#e6eefb}tr{page-break-inside:avoid}</style></head><body>'
            + '<h1>Riwayat Laporan KotaKita</h1>'
            + `<p>${state.semua.length} laporan • dicetak ${esc(K.tanggalWaktu(new Date().toISOString()))}</p>`
            + '<table><thead><tr><th>No</th><th>Kode</th><th>Jenis</th><th>Lokasi</th><th>Tanggal</th><th>Status</th></tr></thead>'
            + `<tbody>${baris}</tbody></table></body></html>`;

        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.append(f);
        const d = f.contentWindow.document;
        d.open(); d.write(html); d.close();
        f.contentWindow.onafterprint = () => f.remove();
        setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { f.remove(); } }, 250);
        setTimeout(() => { if (f.parentNode) f.remove(); }, 120000);
    }

    /* ---------- Data ---------- */
    async function muat() {
        pesan('Memuat laporan…');
        render();
        try {
            state.semua = await K.ambilMilikSaya(state.uid);
            state.siap = true;
            render();
        } catch (err) {
            console.error('[rekamLaporan]', err);
            pesan(K.pesanGalat(err), true);
            isiDetail(null);
        }
    }

    /* ---------- Init ---------- */
    (async function init() {
        if (!K || !window.db || !window.KK || !E.daftar) {
            const g = document.getElementById('kk-guard'); if (g) g.remove();
            if (E.daftar) pesan('Supabase belum dimuat. Periksa tag <script> di rekamLaporan.html.', true);
            return;
        }

        const sesi = await K.pastikanLogin();
        if (!sesi) return;
        state.uid = sesi.user.id;
        K.buka();

        E.filter.forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));
        E.daftar.addEventListener('click', e => {
            const baris = e.target.closest('.report');
            if (!baris || layarKecil()) return;               // di layar kecil langsung buka halaman detail
            e.preventDefault();
            pilih(baris.dataset.kode);
        });
        E.tarik.addEventListener('click', tarik);
        E.unduh.addEventListener('click', unduh);

        muat();
    })();
})();
