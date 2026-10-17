/* =====================================================================
   radiusLokasi.js — radius lokasi laporan milik pengguna (window.KKR)
   Nilai radius disimpan di profil (Profil-Akun.html → kolom profiles.radius)
   dan di-cache di localStorage supaya halaman lain bisa memakainya cepat.

   Dipakai oleh: lokasi.html, dashboard.html, laporan.html
   Pasang SETELAH supabase-js + supabaseClient.js (dan Leaflet bila ada peta).

   API:
     await KKR.muatRadius(uid)          → radius (km), dari profil / cache / default
     KKR.radiusCache()                  → radius (km) dari cache (sinkron)
     KKR.simpanCache(km)                → dipanggil setelah radius disimpan
     await KKR.posisiPengguna()         → { pos:[lat,lng], akurat:boolean }
     KKR.jarakKm(a, b)                  → jarak dua titik [lat,lng] dalam km
     KKR.dalamRadius(pos, titik, km)    → true bila titik berada dalam radius
     KKR.gambarLingkaran(map, pos, km)  → { layer, update(pos, km), hapus() }
     KKR.formatJarak(km)                → "350 m" / "2.4 km"
   ===================================================================== */
(function () {
    'use strict';

    const KEY_RADIUS = 'kk:radius';
    const KEY_POS = 'kk:pos';
    const POS_TTL = 10 * 60 * 1000;               // posisi di-cache 10 menit
    const MIN = 1, MAX = 10, DEFAULT = 4;
    const PUSAT_DEFAULT = [-6.9175, 107.6191];    // Bandung
    const KOLOM_RADIUS = ['radius', 'radius_km', 'radius_laporan', 'radius_lokasi'];

    const batas = (n) => Math.min(MAX, Math.max(MIN, Math.round(n)));
    const valid = (n) => Number.isFinite(n) && n > 0;

    function radiusCache() {
        try {
            const n = Number(localStorage.getItem(KEY_RADIUS));
            return valid(n) ? batas(n) : null;
        } catch (e) { return null; }
    }

    function simpanCache(km) {
        try { localStorage.setItem(KEY_RADIUS, String(batas(Number(km)))); } catch (e) {}
    }

    async function muatRadius(uid) {
        if (window.db && uid) {
            try {
                for (const kol of ['id', 'user_id']) {
                    const { data, error } = await db.from('profiles').select('*').eq(kol, uid).maybeSingle();
                    if (error || !data) continue;
                    const k = KOLOM_RADIUS.find((c) => c in data);
                    const n = k ? Number(data[k]) : NaN;
                    if (valid(n)) { simpanCache(n); return batas(n); }
                    break;
                }
            } catch (e) { console.warn('[radius]', e); }
        }
        return radiusCache() || DEFAULT;
    }

    function posisiCache() {
        try {
            const o = JSON.parse(localStorage.getItem(KEY_POS) || 'null');
            if (o && Array.isArray(o.pos) && Date.now() - o.t < POS_TTL) return o.pos;
        } catch (e) {}
        return null;
    }

    // Memakai window.KKLok (lokasiKota.js): GPS akurasi tinggi → cadangan → posisi terakhir → pusat default.
    // Bila lokasiKota.js tidak dipasang, jatuh ke perilaku lama.
    function posisiPengguna() {
        if (window.KKLok) {
            return window.KKLok.posisi().then((r) => {
                if (r) return { pos: r.pos, akurat: true, sumber: r.sumber };
                return { pos: PUSAT_DEFAULT, akurat: false, sumber: 'default' };
            });
        }
        return new Promise((resolve) => {
            const cache = posisiCache();
            if (cache) return resolve({ pos: cache, akurat: true });
            const cadangan = () => resolve({ pos: PUSAT_DEFAULT, akurat: false });
            if (!navigator.geolocation) return cadangan();
            navigator.geolocation.getCurrentPosition(
                (p) => {
                    const pos = [p.coords.latitude, p.coords.longitude];
                    try { localStorage.setItem(KEY_POS, JSON.stringify({ pos, t: Date.now() })); } catch (e) {}
                    resolve({ pos, akurat: true });
                },
                cadangan,
                { timeout: 8000, maximumAge: POS_TTL }
            );
        });
    }

    function jarakKm(a, b) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
        const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(x));
    }

    function dalamRadius(pos, titik, km) {
        if (!pos || !titik || !Number.isFinite(titik[0]) || !Number.isFinite(titik[1])) return false;
        return jarakKm(pos, titik) <= km;
    }

    const formatJarak = (km) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

    /* Lingkaran radius (+ titik pusat bila opsi.titikPusat !== false) di peta Leaflet */
    function gambarLingkaran(map, pos, km, opsi) {
        const denganTitik = !(opsi && opsi.titikPusat === false);
        const grup = L.layerGroup().addTo(map);
        const lingkaran = L.circle(pos, {
            radius: km * 1000,
            color: '#092e6d', weight: 2, opacity: 0.85,
            fillColor: '#378deb', fillOpacity: 0.08,
            dashArray: '6 6', interactive: false
        }).addTo(grup);
        const pusat = denganTitik ? L.circleMarker(pos, {
            radius: 7, color: '#fff', weight: 3,
            fillColor: '#092e6d', fillOpacity: 1, interactive: false
        }).addTo(grup) : null;
        return {
            layer: grup,
            lingkaran,
            update(p, k) { lingkaran.setLatLng(p).setRadius(k * 1000); if (pusat) pusat.setLatLng(p); },
            hapus() { map.removeLayer(grup); }
        };
    }

    window.KKR = Object.freeze({
        MIN, MAX, DEFAULT, PUSAT_DEFAULT,
        radiusCache, simpanCache, muatRadius, posisiPengguna,
        jarakKm, dalamRadius, gambarLingkaran, formatJarak
    });
})();
