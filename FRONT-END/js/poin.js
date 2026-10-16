/* =====================================================================
   poin.js — saldo & riwayat poin KotaKita (data dari sql/sistem-poin.sql)
   Pasang setelah supabase-js + supabaseClient.js. Dipakai di semua halaman
   yang punya pil "Poin" di navbar, halaman Poin Saya, dan Riwayat.
   Aturan poin: +10 kirim laporan, +15 dikonfirmasi, +25 selesai (dihitung di database).
   ===================================================================== */
(function () {
    'use strict';
    const db = window.db;
    const fmt = n => Number(n || 0).toLocaleString('id-ID');
    const pesanSetup = 'Sistem poin belum aktif: jalankan sql/sistem-poin.sql di Supabase.';

    function tampilkanSaldo(n) {
        const t = fmt(n) + ' Poin';
        document.querySelectorAll('.points').forEach(a => {
            const s = a.querySelector('span:last-child');
            if (s) s.textContent = t;
            a.setAttribute('aria-label', t.toLowerCase());
        });
        document.querySelectorAll('.my-points .right').forEach(e => { e.textContent = t; });
        document.querySelectorAll('.balance-value').forEach(e => {
            e.textContent = fmt(n) + ' ';
            const sp = document.createElement('span'); sp.textContent = 'Poin'; e.append(sp);
        });
        // tombol "Tukar": aktif hanya bila saldo cukup
        document.querySelectorAll('.voucher').forEach(v => {
            const harga = parseInt((v.querySelector('.price') || {}).textContent, 10);
            const b = v.querySelector('.redeem');
            if (b && Number.isFinite(harga)) b.disabled = n < harga;
        });
    }

    const tgl = s => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

    function tampilkanRiwayat(rows) {
        const kosong = document.querySelector('.empty-state');
        if (!kosong) return;
        if (!rows.length) { kosong.textContent = 'Belum ada Riwayat'; return; }
        const ul = document.createElement('ul');
        ul.className = 'riwayat-list';
        rows.forEach(r => {
            const li = document.createElement('li');
            const kiri = document.createElement('div');
            const a = document.createElement('strong'); a.textContent = r.keterangan;
            const b = document.createElement('small'); b.textContent = tgl(r.created_at);
            kiri.append(a, b);
            const p = document.createElement('span'); p.textContent = '+' + r.poin + ' Poin';
            li.append(kiri, p);
            ul.append(li);
        });
        kosong.replaceWith(ul);
    }

    async function muat() {
        if (!db) return;
        const { data: s } = await db.auth.getSession();
        if (!s || !s.session) { tampilkanSaldo(0); return; }
        const { data, error } = await db.rpc('poin_saya');
        if (error) { console.error('[poin] poin_saya gagal:', error.message, '→', pesanSetup); tampilkanSaldo(0); document.querySelectorAll('.points').forEach(a => a.title = 'Gagal memuat poin: ' + error.message); }
        else tampilkanSaldo(data);

        if (document.querySelector('.empty-state')) {
            const r = await db.from('poin_riwayat').select('keterangan,poin,created_at')
                .order('created_at', { ascending: false }).limit(100);
            if (!r.error) tampilkanRiwayat(r.data || []);
        }
    }

    window.KKPoin = { muat };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', muat); else muat();
})();
