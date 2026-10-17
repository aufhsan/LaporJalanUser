/* =====================================================================
   lokasiKota.js — lokasi pengguna saat ini + nama kota di navbar (window.KKLok)
   - posisi(): GPS (akurasi tinggi → cadangan akurasi rendah) → posisi terakhir → null
   - namaKota(pos): reverse geocode (Nominatim → cadangan BigDataCloud), di-cache
   - Otomatis mengisi tombol kota di navbar (.city-picker) di setiap halaman.
   Pasang SEBELUM js/radiusLokasi.js (bila ada) agar peta memakai posisi yang sama.
   ===================================================================== */
(function () {
    'use strict';

    const KEY_POS = 'kk:pos';            // { pos:[lat,lng], t }  — sama dengan radiusLokasi.js
    const KEY_TERAKHIR = 'kk:lastpos';   // posisi terakhir yang pernah terdeteksi (tanpa kedaluwarsa)
    const KEY_KOTA = 'kk:kota';          // nama kota terakhir (agar navbar langsung terisi)
    const KEY_GEO = 'kk:kotageo:';       // cache reverse geocode per kotak ±2 km
    const POS_TTL = 2 * 60 * 1000;       // posisi di-cache 2 menit

    const baca = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const tulis = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } };
    const posOk = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

    function gps(tinggi, timeout) {
        return new Promise((resolve) => {
            if (!('geolocation' in navigator)) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                (p) => resolve([p.coords.latitude, p.coords.longitude]),
                () => resolve(null),
                { enableHighAccuracy: tinggi, timeout, maximumAge: 0 }
            );
        });
    }

    let sedang = null;
    /* → { pos:[lat,lng], sumber:'gps'|'cache'|'terakhir' } atau null bila tidak ada sama sekali */
    function posisi() {
        if (sedang) return sedang;
        sedang = (async () => {
            const c = baca(KEY_POS);
            if (c && posOk(c.pos) && Date.now() - c.t < POS_TTL) return { pos: c.pos, sumber: 'cache' };
            const p = (await gps(true, 12000)) || (await gps(false, 8000));
            if (p) {
                tulis(KEY_POS, { pos: p, t: Date.now() });
                tulis(KEY_TERAKHIR, p);
                return { pos: p, sumber: 'gps' };
            }
            const t = baca(KEY_TERAKHIR);
            return posOk(t) ? { pos: t, sumber: 'terakhir' } : null;
        })();
        sedang.finally(() => { setTimeout(() => { sedang = null; }, 1000); });
        return sedang;
    }

    async function ambilJson(url, ms) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ms || 8000);
        try {
            const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } finally { clearTimeout(t); }
    }

    // "Kota Bandung" → "Bandung"; "Kabupaten Bandung Barat" → "Kab. Bandung Barat"
    function rapikan(n) {
        return String(n || '').trim().replace(/^Kota Administrasi\s+/i, '').replace(/^Kota\s+/i, '')
            .replace(/^Kabupaten\s+/i, 'Kab. ').replace(/^Daerah Khusus Ibukota\s+/i, '').trim();
    }

    async function namaKota(pos) {
        if (!posOk(pos)) return null;
        const kunci = KEY_GEO + pos[0].toFixed(2) + ',' + pos[1].toFixed(2);
        const c = baca(kunci);
        if (c && c.nama) return c.nama;

        let nama = null;
        try {
            const j = await ambilJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=id&lat='
                + pos[0] + '&lon=' + pos[1]);
            const a = (j && j.address) || {};
            nama = rapikan(a.city || a.town || a.municipality || a.county || a.state_district || a.village || a.state);
        } catch (e) { console.warn('[kota] Nominatim gagal:', e.message); }

        if (!nama) {
            try {
                const j = await ambilJson('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=id&latitude='
                    + pos[0] + '&longitude=' + pos[1]);
                nama = rapikan(j && (j.city || j.locality || j.principalSubdivision));
            } catch (e) { console.warn('[kota] BigDataCloud gagal:', e.message); }
        }
        if (nama) tulis(kunci, { nama });
        return nama || null;
    }

    function tampilkanKota(nama) {
        if (!nama) return;
        document.querySelectorAll('.city-picker').forEach((b) => {
            const s = b.querySelector('span:last-child');
            if (s) s.textContent = nama;
            b.setAttribute('aria-label', 'Kota ' + nama);
        });
    }

    async function pasangNavbar() {
        const lama = baca(KEY_KOTA);                  // tampil dulu yang terakhir diketahui
        if (lama) tampilkanKota(lama);
        const p = await posisi();
        if (!p) return;
        const nama = await namaKota(p.pos);
        if (nama) { tulis(KEY_KOTA, nama); tampilkanKota(nama); }
    }

    window.KKLok = Object.freeze({ posisi, namaKota, tampilkanKota, pasangNavbar });

    const mulai = () => { pasangNavbar().catch((e) => console.warn('[kota]', e)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai); else mulai();
})();
