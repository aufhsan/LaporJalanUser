/* =====================================================================
   dashboard.js — dashboard.html
     - wajib login (tanpa sesi → login.html)
     - ambil laporan publik: rpc('laporan_publik')
     - "Isu Terdekat": laporan belum selesai, diurutkan berdasarkan jarak
       bila izin lokasi diberikan, jika tidak berdasarkan yang terbaru
     - "Laporan Terbaru": 3 laporan terakhir
     - kolom cari menyaring kedua daftar (alamat, kategori, deskripsi)
     - peta Leaflet (OpenStreetMap) di <div id="map">:
         · pusat peta = posisi user (navigator.geolocation); bila ditolak/mati
           → kota asal dari tabel profiles, di-geocode via Nominatim (cadangan: Photon)
         · pin user + pin tiap laporan (lokasi_lat / lokasi_lng)
         · klik pin → popup deskripsi, status, dan jarak
   Butuh: window.db dan window.KK (supabaseClient.js)
   ===================================================================== */
(function () {
    'use strict';

    const WAJIB_LOGIN = true;
    const HALAMAN_LOGIN = 'login.html';
    const HALAMAN_DETAIL = 'detailLaporan.html';
    const AMBIL = 200;           // jumlah laporan yang diminta dari database
    const BATAS_ISU = 5;
    const BATAS_TERBARU = 3;

    const PUSAT_DEFAULT = { lat: -6.9175, lon: 107.6191 };   // Bandung, bila semua cara gagal
    const ZOOM_DEFAULT = 13, ZOOM_USER = 15, ZOOM_KOTA = 12;
    const CACHE_GEO = 'kk_geo_';                             // cache hasil geocoding per kota
    const WARNA_TINGKAT = { ringan: '#f2b705', sedang: '#f08c00', parah: '#e03131' };
    const WARNA_SELESAI = '#2f9e44', WARNA_DEFAULT = '#ad0000';

    const $ = id => document.getElementById(id);
    const boxIsu = $('daftarIsu');
    const boxTerbaru = $('daftarLaporan');
    const infoIsu = $('isuInfo');
    const inCari = $('cariLokasi');
    const guard = $('kk-guard');

    // anchor = posisi GPS user (dipakai mengurutkan "Isu Terdekat")
    // pusat  = titik kota asal (hanya cadangan untuk peta & jarak perkiraan)
    const state = { laporan: [], anchor: null, pusat: null, kata: '', siap: false };

    const bukaTampilan = () => { if (guard) guard.remove(); };
    setTimeout(bukaTampilan, 4000);                  // jaring pengaman

    /* ---------- Helper ---------- */
    const FOTO_KOSONG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#687482"/></svg>');

    const urlAman = u => (/^https?:\/\//i.test(u || '') ? u : '');
    const tingkatOk = r => (['ringan', 'sedang', 'parah'].includes(r.tingkat) ? r.tingkat : null);

    function el(tag, kelas, teks) {
        const e = document.createElement(tag);
        if (kelas) e.className = kelas;
        if (teks != null) e.textContent = teks;
        return e;
    }

    const angka = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
    const koordinatOk = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
        && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

    const RTF = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
    function waktuRelatif(iso) {
        const t = new Date(iso).getTime();
        if (isNaN(t)) return '-';
        const d = Math.round((t - Date.now()) / 1000), a = Math.abs(d);
        if (a < 45) return 'baru saja';
        if (a < 3600) return RTF.format(Math.round(d / 60), 'minute');
        if (a < 86400) return RTF.format(Math.round(d / 3600), 'hour');
        if (a < 2592000) return RTF.format(Math.round(d / 86400), 'day');
        if (a < 31536000) return RTF.format(Math.round(d / 2592000), 'month');
        return RTF.format(Math.round(d / 31536000), 'year');
    }

    function jarakKm(a, r) {
        const R = 6371, rad = x => x * Math.PI / 180;
        const dLat = rad(r.latitude - a.lat), dLon = rad(r.longitude - a.lon);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(r.latitude)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    const fmtJarak = km => (km < 1
        ? Math.round(km * 1000) + ' m'
        : km.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' km');

    function judulLaporan(r) {
        if (r.kategori) return tingkatOk(r) ? `${r.kategori} (${r.tingkat})` : r.kategori;
        const d = (r.deskripsi || '').replace(/\s+/g, ' ').trim();
        if (d) { const k = d.split(/[.!?]\s/)[0]; return k.length > 64 ? k.slice(0, 61).trimEnd() + '…' : k; }
        return 'Jalan rusak' + (tingkatOk(r) ? ` (${r.tingkat})` : '');
    }

    const lokasiLaporan = r => r.alamat
        || (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
            ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` : 'Lokasi tidak diketahui');

    const cocok = r => !state.kata
        || [r.alamat, r.kategori, r.deskripsi].join(' ').toLowerCase().includes(state.kata);

    function bukaDetail(r) {
        if (r.kode) window.location.href = `${HALAMAN_DETAIL}?kode=${encodeURIComponent(r.kode)}`;
    }

    function jadikanTautan(node, r) {
        if (!r.kode) return;
        node.setAttribute('role', 'link');
        node.tabIndex = 0;
        node.addEventListener('click', () => bukaDetail(r));
        node.addEventListener('keydown', e => { if (e.key === 'Enter') bukaDetail(r); });
    }

    function pesan(box, teks, galat) {
        box.replaceChildren(el('p', 'kk-info' + (galat ? ' kk-info--err' : ''), teks));
    }

    function pesanGalat(err) {
        const m = String((err && err.message) || '').toLowerCase();
        if ((err && err.code === 'PGRST202') || m.includes('could not find the function'))
            return 'Fungsi database "laporan_publik" belum dibuat. Jalankan sql/setup-laporan-publik.sql di Supabase.';
        if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet Anda lalu muat ulang.';
        return 'Gagal memuat laporan: ' + ((err && err.message) || 'terjadi kesalahan.');
    }

    /* ---------- Render ---------- */
    function renderIsu() {
        if (!state.siap) return;
        let daftar = state.laporan.filter(r => r.status !== 'selesai' && cocok(r));

        if (state.anchor) {
            daftar = daftar
                .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
                .map(r => ({ r, km: jarakKm(state.anchor, r) }))
                .sort((a, b) => a.km - b.km);
            infoIsu.textContent = 'Terdekat dari lokasi Anda';
        } else {
            daftar = daftar
                .sort((a, b) => new Date(b.waktu) - new Date(a.waktu))
                .map(r => ({ r, km: null }));
            infoIsu.textContent = 'Menampilkan yang terbaru. Izinkan akses lokasi untuk mengurutkan berdasarkan jarak.';
        }
        daftar = daftar.slice(0, BATAS_ISU);

        if (!daftar.length) {
            pesan(boxIsu, state.kata ? 'Tidak ada isu yang cocok dengan pencarian.' : 'Belum ada isu aktif.');
            return;
        }

        boxIsu.replaceChildren(...daftar.map(({ r, km }) => {
            const a = el('article', 'issue');
            const t = tingkatOk(r);
            if (t) a.dataset.tingkat = t;

            const isi = el('div');
            isi.append(
                el('h3', 'issue__title', judulLaporan(r)),
                el('p', 'issue__location', lokasiLaporan(r) + (km != null ? ' • ' + fmtJarak(km) : '')),
                el('p', 'issue__time', waktuRelatif(r.waktu) + ' dilaporkan')
            );
            a.append(isi);
            a.insertAdjacentHTML('beforeend', '<svg class="icon" aria-hidden="true"><use href="#icon-chevron"/></svg>');
            jadikanTautan(a, r);
            return a;
        }));
    }

    function renderTerbaru() {
        if (!state.siap) return;
        const daftar = state.laporan
            .filter(cocok)
            .sort((a, b) => new Date(b.waktu) - new Date(a.waktu))
            .slice(0, BATAS_TERBARU);

        if (!daftar.length) {
            pesan(boxTerbaru, state.kata ? 'Tidak ada laporan yang cocok dengan pencarian.' : 'Belum ada laporan.');
            return;
        }

        boxTerbaru.replaceChildren(...daftar.map(r => {
            const a = el('article', 'report');
            const img = el('img', 'report__image');
            img.alt = judulLaporan(r);
            img.loading = 'lazy';
            img.onerror = () => { img.onerror = null; img.src = FOTO_KOSONG; };
            img.src = urlAman(r.foto_url) || FOTO_KOSONG;

            const isi = el('div', 'report__content');
            isi.append(
                el('h3', 'report__title', lokasiLaporan(r)),
                el('p', 'report__description', `${judulLaporan(r)} • ${waktuRelatif(r.waktu)}`)
            );
            a.append(img, isi);
            jadikanTautan(a, r);
            return a;
        }));
    }

    const renderSemua = () => { renderIsu(); renderTerbaru(); renderMarkerLaporan(); };

    /* ---------- Data ---------- */
    async function muat() {
        pesan(boxIsu, 'Memuat laporan…');
        pesan(boxTerbaru, 'Memuat laporan…');

        const { data, error } = await db.rpc('laporan_publik', { p_limit: AMBIL });
        if (error) {
            console.error(error);
            const teks = pesanGalat(error);
            pesan(boxIsu, teks, true);
            pesan(boxTerbaru, teks, true);
            infoIsu.textContent = '';
            return;
        }

        // Kolom dari rpc: lokasi_lat / lokasi_lng (latitude / longitude tetap diterima)
        state.laporan = (data || []).map(r => ({
            ...r,
            latitude: angka(r.lokasi_lat != null ? r.lokasi_lat : r.latitude),
            longitude: angka(r.lokasi_lng != null ? r.lokasi_lng : r.longitude)
        }));
        state.siap = true;
        renderSemua();
    }

    /* ---------- Peta (Leaflet) ---------- */
    const peta = { map: null, layer: null, user: null, catatanEl: null };

    function ikonPin(warna) {
        return L.divIcon({
            className: 'kk-pin',
            html: '<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true">'
                + '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" '
                + 'fill="' + warna + '" stroke="#fff" stroke-width="1.5"/>'
                + '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>',
            iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36]
        });
    }

    const ikonUser = perkiraan => L.divIcon({
        className: 'kk-pin',
        html: '<span class="kk-me' + (perkiraan ? ' kk-me--kota' : '') + '"></span>',
        iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12]
    });

    const warnaLaporan = r => (r.status === 'selesai' ? WARNA_SELESAI : WARNA_TINGKAT[tingkatOk(r)] || WARNA_DEFAULT);

    const labelStatus = s => String(s || 'tidak diketahui').replace(/_/g, ' ');

    function jarakKeUser(r) {
        if (state.anchor) return { km: jarakKm(state.anchor, r), ket: 'dari lokasi Anda' };
        if (state.pusat) return { km: jarakKm(state.pusat, r), ket: `dari pusat ${state.pusat.nama} (perkiraan)` };
        return null;
    }

    function barisInfo(label, nilai) {
        const p = el('p', 'kk-pop__row');
        p.append(el('strong', null, label + ': '), document.createTextNode(nilai));
        return p;
    }

    // Dibuat saat popup dibuka, jadi jarak selalu memakai posisi user terbaru.
    function isiPopup(r) {
        const box = el('div', 'kk-pop');
        box.append(el('h3', 'kk-pop__title', judulLaporan(r)));

        const meta = el('div', 'kk-pop__meta');
        meta.append(el('span', 'kk-badge kk-badge--' + (r.status === 'selesai' ? 'ok' : 'aktif'), labelStatus(r.status)));
        const t = tingkatOk(r);
        if (t) meta.append(el('span', 'kk-badge kk-badge--' + t, t));
        box.append(meta);

        const d = (r.deskripsi || '').replace(/\s+/g, ' ').trim();
        box.append(el('p', 'kk-pop__desc', d ? (d.length > 160 ? d.slice(0, 157).trimEnd() + '…' : d) : 'Tidak ada deskripsi.'));

        box.append(barisInfo('Lokasi', lokasiLaporan(r)));
        const j = jarakKeUser(r);
        box.append(barisInfo('Jarak', j ? `${fmtJarak(j.km)} ${j.ket}` : 'tidak diketahui (aktifkan izin lokasi)'));
        if (r.waktu) box.append(barisInfo('Dilaporkan', waktuRelatif(r.waktu)));

        if (r.kode) {
            const b = el('button', 'kk-pop__btn', 'Lihat detail');
            b.type = 'button';
            b.addEventListener('click', () => bukaDetail(r));
            box.append(b);
        }
        return box;
    }

    function renderMarkerLaporan() {
        if (!peta.map || !state.siap) return;
        peta.layer.clearLayers();
        state.laporan
            .filter(r => koordinatOk(r.latitude, r.longitude) && cocok(r))
            .forEach(r => {
                L.marker([r.latitude, r.longitude], { icon: ikonPin(warnaLaporan(r)), title: judulLaporan(r), riseOnHover: true })
                    .bindPopup(() => isiPopup(r), { maxWidth: 280 })
                    .addTo(peta.layer);
            });
    }

    function catat(teks) {
        if (!peta.catatanEl) return;
        peta.catatanEl.textContent = teks || '';
        peta.catatanEl.hidden = !teks;
    }

    function letakkanUser(lat, lon, perkiraan, nama) {
        if (!peta.map) return;
        const ll = [lat, lon];
        if (!peta.user) peta.user = L.marker(ll, { zIndexOffset: 1000, keyboard: false }).addTo(peta.map);
        peta.user.setLatLng(ll).setIcon(ikonUser(perkiraan));
        peta.user.bindPopup(perkiraan ? `Pusat kota ${nama} (perkiraan)` : 'Lokasi Anda');
    }

    function initPeta() {
        const wadah = $('map');
        if (!wadah) return;
        if (!window.L) {
            wadah.replaceChildren(el('p', 'kk-info kk-info--err', 'Peta gagal dimuat (Leaflet). Periksa koneksi internet lalu muat ulang.'));
            return;
        }
        peta.map = L.map(wadah).setView([PUSAT_DEFAULT.lat, PUSAT_DEFAULT.lon], ZOOM_DEFAULT);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        }).addTo(peta.map);
        peta.layer = L.layerGroup().addTo(peta.map);

        const Catatan = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                const d = L.DomUtil.create('div', 'kk-map-note');
                d.hidden = true;
                L.DomEvent.disableClickPropagation(d);
                peta.catatanEl = d;
                return d;
            }
        });
        new Catatan().addTo(peta.map);

        renderMarkerLaporan();                       // bila data sudah tiba lebih dulu
        setTimeout(() => peta.map.invalidateSize(), 0);
    }

    /* ---------- Lokasi user & geocoding kota asal ---------- */
    function ambilPosisi() {
        return new Promise(resolve => {
            if (!('geolocation' in navigator)) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                () => resolve(null),                 // ditolak / mati / timeout
                { timeout: 8000, maximumAge: 600000 }
            );
        });
    }

    async function ambilKotaAsal(sesi) {
        const user = sesi && sesi.user;
        if (user && user.id) {
            try {
                const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
                if (error) console.warn('[dashboard] profiles:', error.message);
                const k = data && (data.kota || data.city || data.kota_asal);
                if (k && String(k).trim()) return String(k).trim();
            } catch (e) { console.warn('[dashboard] profiles:', e); }
        }
        // cadangan: metadata yang dikirim saat pendaftaran (regist.js → { kota })
        const m = user && user.user_metadata;
        return m && m.kota ? String(m.kota).trim() : null;
    }

    async function ambilJson(url, ms) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ms || 8000);
        try {
            const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally { clearTimeout(t); }
    }

    // Nominatim dulu (dibatasi ke Indonesia), Photon sebagai cadangan. Hasil di-cache
    // agar tidak membebani layanan gratis tersebut pada tiap kunjungan.
    async function geocodeKota(kota) {
        const kunci = CACHE_GEO + kota.toLowerCase();
        try {
            const c = JSON.parse(localStorage.getItem(kunci) || 'null');
            if (c && koordinatOk(c.lat, c.lon)) return c;
        } catch (_) { /* abaikan */ }

        let hasil = null;
        try {
            const j = await ambilJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=id&accept-language=id&q='
                + encodeURIComponent(kota));
            if (j && j[0]) hasil = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
        } catch (e) { console.warn('[dashboard] Nominatim gagal:', e.message); }

        if (!hasil || !koordinatOk(hasil.lat, hasil.lon)) {
            hasil = null;
            try {
                const j = await ambilJson('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(kota + ', Indonesia'));
                const c = j && j.features && j.features[0] && j.features[0].geometry.coordinates;
                if (c) hasil = { lat: Number(c[1]), lon: Number(c[0]) };
            } catch (e) { console.warn('[dashboard] Photon gagal:', e.message); }
        }

        if (!hasil || !koordinatOk(hasil.lat, hasil.lon)) return null;
        try { localStorage.setItem(kunci, JSON.stringify(hasil)); } catch (_) { /* abaikan */ }
        return hasil;
    }

    // GPS → (ditolak) kota asal di profiles → (gagal) Bandung
    async function tentukanPusat(sesi) {
        if (!peta.map) { const p = await ambilPosisi(); if (p) { state.anchor = p; renderIsu(); } return; }

        const pos = await ambilPosisi();
        if (pos) {
            state.anchor = pos;
            renderIsu();                              // "Isu Terdekat" kini urut berdasarkan jarak
            letakkanUser(pos.lat, pos.lon, false);
            peta.map.setView([pos.lat, pos.lon], ZOOM_USER);
            catat('');
            return;
        }

        const kota = await ambilKotaAsal(sesi);
        const p = kota ? await geocodeKota(kota) : null;
        if (p) {
            state.pusat = { lat: p.lat, lon: p.lon, nama: kota };
            letakkanUser(p.lat, p.lon, true, kota);
            peta.map.setView([p.lat, p.lon], ZOOM_KOTA);
            catat(`Lokasi tidak aktif. Peta berpusat di kota asal Anda: ${kota}.`);
        } else {
            catat(kota
                ? `Lokasi tidak aktif dan kota "${kota}" tidak ditemukan. Menampilkan Bandung.`
                : 'Lokasi tidak aktif dan kota asal belum diisi. Menampilkan Bandung.');
        }
    }

    /* ---------- Init ---------- */
    let timerCari = null;
    if (inCari) {
        inCari.addEventListener('input', () => {
            clearTimeout(timerCari);
            timerCari = setTimeout(() => { state.kata = inCari.value.trim().toLowerCase(); renderSemua(); }, 250);
        });
    }

    (async function init() {
        if (!window.db || !window.KK) {
            bukaTampilan();
            pesan(boxIsu, 'Supabase belum dimuat. Periksa tag <script> di dashboard.html.', true);
            pesan(boxTerbaru, 'Supabase belum dimuat.', true);
            return;
        }

        const sesi = await window.KK.ambilSesi();
        if (WAJIB_LOGIN && !sesi) { window.location.replace(HALAMAN_LOGIN); return; }
        bukaTampilan();

        // Logout dari tab lain → kembali ke login
        db.auth.onAuthStateChange(event => {
            if (WAJIB_LOGIN && event === 'SIGNED_OUT') window.location.replace(HALAMAN_LOGIN);
        });

        initPeta();
        muat();
        tentukanPusat(sesi);
    })();
})();
