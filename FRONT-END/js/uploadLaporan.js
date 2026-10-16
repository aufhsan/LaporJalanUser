/* =====================================================================
   uploadLaporan.js — uploadLaporan.html
     - wajib login (tanpa sesi → login.html)
     - titik lokasi: ikuti GPS (watchPosition) atau pilih manual di peta
       Leaflet (ketuk peta / geser pin). Bila GPS ditolak/mati, peta
       berpusat di kota asal user (profiles → Nominatim/Photon).
     - alamat otomatis dari titik (reverse geocoding Nominatim)
     - foto: dipilih dari kamera/galeri, dikompres di browser (maks. 1600 px,
       JPEG) lalu diunggah ke Supabase Storage bucket "foto_laporan"
     - simpan baris baru ke tabel "laporan_jalan"
   Butuh: Leaflet, window.db dan window.KK (supabaseClient.js)
   SQL pendukung: sql/setup-laporan-baru.sql
   ===================================================================== */
(function () {
    'use strict';

    /* ---------- Konfigurasi ---------- */
    const WAJIB_LOGIN = true;
    const HALAMAN_LOGIN = 'login.html';
    const HALAMAN_SUKSES = 'laporanTerkonfirmasi.html';

    const TABEL = 'laporan_jalan';
    const BUCKET = 'foto_laporan';

    // Nama kolom di tabel. Ubah di sini bila skema Anda berbeda.
    const KOLOM = {
        user_id: 'user_id',
        kategori: 'kategori',
        tingkat: 'tingkat',
        deskripsi: 'deskripsi',
        alamat: 'alamat',
        lat: 'latitude',
        lng: 'longitude',
        foto_url: 'foto_url',
        status: 'status',
        kode: 'kode'
    };
    // Status awal laporan baru. Harus lolos laporan_jalan_status_check
    // (lihat sql/perbaiki-status-check.sql); trigger di database juga memaksa nilai ini.
    const STATUS_AWAL = 'menunggu';

    const FOTO_MAKS_INPUT = 15 * 1024 * 1024;   // foto asli dari kamera/galeri
    const FOTO_MAKS_UPLOAD = 5 * 1024 * 1024;   // sama dengan batas bucket
    const FOTO_SISI_MAKS = 1600;                // px, sisi terpanjang setelah kompresi
    const FOTO_KUALITAS = 0.82;

    const DESK_MIN = 10, DESK_MAX = 500;

    const PUSAT_DEFAULT = { lat: -6.9175, lon: 107.6191 };   // Bandung
    const ZOOM_DEFAULT = 13, ZOOM_KOTA = 13, ZOOM_TITIK = 17;
    const CACHE_GEO = 'kk_geo_';                             // cache yang sama dengan dashboard.js
    const AKURASI_BURUK = 100;                               // meter

    /* ---------- Elemen ---------- */
    const $ = id => document.getElementById(id);
    const guard = $('kk-guard');
    const E = {
        kamera: $('btnKamera'), galeri: $('btnGaleri'),
        inKamera: $('inputKamera'), inGaleri: $('inputGaleri'),
        fotoBox: $('fotoBox'), fotoIkon: $('fotoIkon'), fotoImg: $('fotoPratinjau'),
        fotoJudul: $('fotoJudul'), fotoBantu: $('fotoBantu'), fotoHapus: $('fotoHapus'),
        panelFoto: $('panelFoto'),
        peta: $('petaLokasi'), kartuLokasi: $('kartuLokasi'),
        alamatUtama: $('alamatUtama'), alamatRinci: $('alamatRinci'), infoLokasi: $('infoLokasi'),
        btnGps: $('btnGps'),
        kategori: $('opsiKategori'), tingkat: $('opsiTingkat'), panelKategori: $('panelKategori'), panelTingkat: $('panelTingkat'),
        deskripsi: $('deskripsi'), hitung: $('hitungDeskripsi'), panelDeskripsi: $('panelDeskripsi'),
        pesan: $('pesanForm'), kirim: $('btnKirim')
    };

    const TEKS_AWAL = {
        fotoJudul: E.fotoJudul ? E.fotoJudul.textContent : '',
        fotoBantu: E.fotoBantu ? E.fotoBantu.textContent : '',
        alamatUtama: 'Lokasi belum dipilih',
        alamatRinci: 'Ketuk peta atau aktifkan GPS untuk menandai titik'
    };

    const state = {
        foto: null,            // { blob, url, nama }
        titik: null,           // { lat, lon }
        mode: 'manual',        // 'gps' | 'manual'
        alamat: '',            // teks lengkap untuk kolom alamat
        watchId: null,
        kirim: false
    };

    const bukaTampilan = () => { if (guard) guard.remove(); };
    setTimeout(bukaTampilan, 4000);                  // jaring pengaman

    /* ---------- Helper umum ---------- */
    const angka2 = n => n.toFixed(5);
    const fmtUkuran = b => (b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB');

    function jarakM(a, b) {
        const R = 6371000, rad = x => x * Math.PI / 180;
        const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function acak() {
        try {
            const b = new Uint8Array(6);
            crypto.getRandomValues(b);
            return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        } catch (_) { return Math.random().toString(16).slice(2, 14); }
    }

    function tampilPesan(teks, jenis) {
        if (!E.pesan) return;
        E.pesan.textContent = teks || '';
        E.pesan.hidden = !teks;
        E.pesan.className = 'kk-form-msg' + (jenis ? ' kk-form-msg--' + jenis : '');
    }

    function tandaiSalah(panel, salah) {
        if (panel) panel.classList.toggle('panel--err', !!salah);
    }

    async function ambilJson(url, ms, signal) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ms || 8000);
        if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
        try {
            const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally { clearTimeout(t); }
    }

    const koordinatOk = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
        && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

    /* =================================================================
       FOTO
       ================================================================= */
    async function dekodeGambar(file) {
        if (window.createImageBitmap) {
            try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* coba cara lain */ }
        }
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.'));
            };
            img.src = url;
        });
    }

    // Perkecil + ubah ke JPEG. Efek samping yang diinginkan: metadata EXIF
    // (termasuk koordinat GPS tersembunyi di foto) ikut terhapus.
    async function kompres(file) {
        const src = await dekodeGambar(file);
        const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
        if (!w0 || !h0) throw new Error('Foto tidak dapat dibaca.');
        const skala = Math.min(1, FOTO_SISI_MAKS / Math.max(w0, h0));
        const w = Math.round(w0 * skala), h = Math.round(h0 * skala);

        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Browser tidak mendukung pemrosesan foto.');
        ctx.fillStyle = '#ffffff';                   // PNG transparan → latar putih
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0, w, h);
        if (typeof src.close === 'function') src.close();

        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', FOTO_KUALITAS));
        if (!blob) throw new Error('Gagal memproses foto.');
        return blob;
    }

    function tampilkanFoto() {
        const f = state.foto;
        // toggleAttribute (bukan .hidden): SVG tidak punya properti hidden
        E.fotoImg.toggleAttribute('hidden', !f);
        E.fotoIkon.toggleAttribute('hidden', !!f);
        E.fotoHapus.toggleAttribute('hidden', !f);
        if (f) {
            E.fotoImg.src = f.url;
            E.fotoJudul.textContent = f.nama.length > 28 ? f.nama.slice(0, 25) + '…' : f.nama;
            E.fotoBantu.textContent = `${fmtUkuran(f.blob.size)} • siap diunggah. Pilih lagi untuk mengganti.`;
        } else {
            E.fotoImg.removeAttribute('src');
            E.fotoJudul.textContent = TEKS_AWAL.fotoJudul;
            E.fotoBantu.textContent = TEKS_AWAL.fotoBantu;
        }
    }

    function hapusFoto() {
        if (state.foto) URL.revokeObjectURL(state.foto.url);
        state.foto = null;
        tampilkanFoto();
    }

    async function pilihFoto(input) {
        const file = input.files && input.files[0];
        input.value = '';                            // izinkan memilih file yang sama lagi
        if (!file) return;
        tampilPesan('');

        if (file.type && !/^image\//i.test(file.type)) { tampilPesan('File harus berupa gambar (JPG, PNG, atau WebP).', 'err'); return; }
        if (file.size > FOTO_MAKS_INPUT) { tampilPesan('Ukuran foto terlalu besar (maks. 15 MB).', 'err'); return; }

        E.fotoBantu.textContent = 'Memproses foto…';
        try {
            const blob = await kompres(file);
            if (blob.size > FOTO_MAKS_UPLOAD) throw new Error('Foto masih lebih dari 5 MB setelah dikompres. Coba foto lain.');
            if (state.foto) URL.revokeObjectURL(state.foto.url);
            state.foto = { blob, url: URL.createObjectURL(blob), nama: file.name || 'foto.jpg' };
            tandaiSalah(E.panelFoto, false);
        } catch (err) {
            console.warn('[uploadLaporan] foto:', err);
            tampilPesan(err.message || 'Foto tidak dapat diproses.', 'err');
        }
        tampilkanFoto();
    }

    /* =================================================================
       PETA & LOKASI
       ================================================================= */
    let peta = null, marker = null, lingkaran = null;

    function ikonPin() {
        return L.divIcon({
            className: 'kk-pin',
            html: '<svg viewBox="0 0 24 32" width="34" height="46" aria-hidden="true">'
                + '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" '
                + 'fill="#092e6d" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>',
            iconSize: [34, 46], iconAnchor: [17, 46], popupAnchor: [0, -40]
        });
    }

    function info(teks, peringatan) {
        if (!E.infoLokasi) return;
        E.infoLokasi.textContent = teks || '';
        E.infoLokasi.classList.toggle('location-card__hint--warn', !!peringatan);
    }

    function tampilAlamat(utama, rinci) {
        E.alamatUtama.textContent = utama;
        E.alamatRinci.textContent = rinci || '';
    }

    function setTombolGps(aktif) {
        E.btnGps.classList.toggle('active', aktif);
        E.btnGps.setAttribute('aria-pressed', aktif ? 'true' : 'false');
    }

    function hentikanGps() {
        if (state.watchId !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        state.mode = 'manual';
        setTombolGps(false);
        if (lingkaran) { lingkaran.remove(); lingkaran = null; }
    }

    function setTitik(lat, lon, dariGps) {
        state.titik = { lat, lon };
        tandaiSalah(E.kartuLokasi, false);

        if (!marker) {
            marker = L.marker([lat, lon], { draggable: true, icon: ikonPin(), title: 'Titik lokasi laporan', keyboard: true }).addTo(peta);
            marker.on('dragend', () => {
                const p = marker.getLatLng();
                hentikanGps();
                state.titik = { lat: p.lat, lon: p.lng };
                info('Titik dipilih manual. Geser pin atau ketuk peta untuk menyesuaikan.');
                jadwalkanAlamat();
            });
        } else {
            marker.setLatLng([lat, lon]);
        }
        if (!dariGps) jadwalkanAlamat();
    }

    function pilihManual(lat, lon) {
        hentikanGps();
        setTitik(lat, lon, false);
        info('Titik dipilih manual. Geser pin atau ketuk peta untuk menyesuaikan.');
    }

    function mulaiGps(awal) {
        if (!('geolocation' in navigator)) {
            info('Perangkat tidak mendukung GPS. Ketuk peta untuk memilih titik.', true);
            if (awal) pusatDariKota();
            return;
        }
        hentikanGps();
        state.mode = 'gps';
        setTombolGps(true);
        info('Mencari lokasi GPS…');

        let pertama = true;
        state.watchId = navigator.geolocation.watchPosition(
            pos => {
                const { latitude: lat, longitude: lon, accuracy } = pos.coords;
                setTitik(lat, lon, true);
                if (lingkaran) lingkaran.setLatLng([lat, lon]).setRadius(accuracy);
                else lingkaran = L.circle([lat, lon], { radius: accuracy, weight: 1, color: '#1c6ef2', fillOpacity: 0.1, interactive: false }).addTo(peta);

                if (pertama) { peta.setView([lat, lon], ZOOM_TITIK); pertama = false; jadwalkanAlamat(true); }
                else { if (!peta.getBounds().contains([lat, lon])) peta.panTo([lat, lon]); jadwalkanAlamat(); }

                const a = Math.round(accuracy);
                info(a > AKURASI_BURUK
                    ? `Mengikuti GPS • akurasi ±${a} m (kurang tepat). Geser pin ke lokasi yang benar.`
                    : `Mengikuti GPS • akurasi ±${a} m. Geser pin bila perlu.`, a > AKURASI_BURUK);
            },
            err => {
                const adaTitik = !!state.titik;
                hentikanGps();
                const pesan = err.code === 1 ? 'Izin lokasi ditolak.'
                    : err.code === 3 ? 'Lokasi GPS terlalu lama didapat.'
                    : 'Lokasi GPS tidak tersedia.';
                info(pesan + ' Ketuk peta untuk memilih titik secara manual.', true);
                if (awal && !adaTitik) pusatDariKota();
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
    }

    /* ----- cadangan: kota asal user (sama seperti dashboard.js) ----- */
    async function ambilKotaAsal(sesi) {
        const user = sesi && sesi.user;
        if (user && user.id) {
            try {
                const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
                if (error) console.warn('[uploadLaporan] profiles:', error.message);
                const k = data && (data.kota || data.city || data.kota_asal);
                if (k && String(k).trim()) return String(k).trim();
            } catch (e) { console.warn('[uploadLaporan] profiles:', e); }
        }
        const m = user && user.user_metadata;
        return m && m.kota ? String(m.kota).trim() : null;
    }

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
        } catch (e) { console.warn('[uploadLaporan] Nominatim gagal:', e.message); }

        if (!hasil || !koordinatOk(hasil.lat, hasil.lon)) {
            hasil = null;
            try {
                const j = await ambilJson('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(kota + ', Indonesia'));
                const c = j && j.features && j.features[0] && j.features[0].geometry.coordinates;
                if (c) hasil = { lat: Number(c[1]), lon: Number(c[0]) };
            } catch (e) { console.warn('[uploadLaporan] Photon gagal:', e.message); }
        }

        if (!hasil || !koordinatOk(hasil.lat, hasil.lon)) return null;
        try { localStorage.setItem(kunci, JSON.stringify(hasil)); } catch (_) { /* abaikan */ }
        return hasil;
    }

    let sesiSaatIni = null;
    async function pusatDariKota() {
        const kota = await ambilKotaAsal(sesiSaatIni);
        const p = kota ? await geocodeKota(kota) : null;
        if (state.titik) return;                     // user sudah memilih titik selama menunggu
        if (p) {
            peta.setView([p.lat, p.lon], ZOOM_KOTA);
            info(`GPS tidak aktif. Peta berpusat di kota asal Anda (${kota}). Ketuk peta untuk menandai lokasi masalah.`, true);
        } else {
            info('GPS tidak aktif. Ketuk peta untuk menandai lokasi masalah.', true);
        }
    }

    /* ----- alamat dari titik (reverse geocoding) ----- */
    let timerAlamat = null, acAlamat = null, titikAlamat = null;

    function jadwalkanAlamat(segera) {
        clearTimeout(timerAlamat);
        timerAlamat = setTimeout(cariAlamat, segera ? 0 : 900);
    }

    function rakitAlamat(j, t) {
        const a = (j && j.address) || {};
        const jalan = a.road || a.pedestrian || a.footway || a.residential || a.path || a.neighbourhood;
        const utama = jalan
            ? (a.house_number ? `${jalan} No. ${a.house_number}` : jalan)
            : ((j && j.name) || (j && j.display_name ? String(j.display_name).split(',')[0] : ''));
        const rinci = [
            a.suburb || a.village || a.hamlet,
            a.city_district || a.subdistrict || a.county,
            a.city || a.town || a.municipality || a.regency || a.state_district
        ].filter((x, i, arr) => x && arr.indexOf(x) === i).join(', ');
        return utama
            ? { utama, rinci }
            : { utama: `${angka2(t.lat)}, ${angka2(t.lon)}`, rinci: '' };
    }

    async function cariAlamat() {
        const t = state.titik;
        if (!t) return;
        if (titikAlamat && jarakM(titikAlamat, t) < 15 && state.alamat) return;   // GPS hanya bergeser sedikit
        titikAlamat = { ...t };

        if (acAlamat) acAlamat.abort();
        acAlamat = new AbortController();
        tampilAlamat('Mencari alamat…', `${angka2(t.lat)}, ${angka2(t.lon)}`);

        let hasil;
        try {
            const j = await ambilJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=id'
                + `&lat=${t.lat}&lon=${t.lon}`, 8000, acAlamat.signal);
            hasil = rakitAlamat(j, t);
        } catch (e) {
            if (e && e.name === 'AbortError' && state.titik && jarakM(state.titik, t) > 15) return;   // sudah digantikan pencarian baru
            hasil = { utama: `${angka2(t.lat)}, ${angka2(t.lon)}`, rinci: 'Alamat tidak ditemukan, koordinat akan disimpan' };
        }
        if (!state.titik || jarakM(state.titik, t) > 15) return;                   // titik sudah pindah jauh
        state.alamat = [hasil.utama, hasil.rinci].filter(Boolean).join(', ');
        tampilAlamat(hasil.utama, hasil.rinci);
    }

    function initPeta() {
        if (!window.L) {
            E.peta.textContent = 'Peta gagal dimuat (Leaflet). Periksa koneksi internet lalu muat ulang.';
            E.peta.classList.add('petaLokasi--err');
            return false;
        }
        peta = L.map(E.peta).setView([PUSAT_DEFAULT.lat, PUSAT_DEFAULT.lon], ZOOM_DEFAULT);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        }).addTo(peta);

        peta.on('click', e => pilihManual(e.latlng.lat, e.latlng.lng));

        if ('ResizeObserver' in window) new ResizeObserver(() => peta.invalidateSize()).observe(E.peta);
        setTimeout(() => peta.invalidateSize(), 0);

        tampilAlamat(TEKS_AWAL.alamatUtama, TEKS_AWAL.alamatRinci);
        return true;
    }

    /* =================================================================
       FORM
       ================================================================= */
    function pilihOpsi(grup, tombol, panel) {
        grup.querySelectorAll('button').forEach(b => {
            const aktif = b === tombol;
            b.classList.toggle('selected', aktif);
            b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
        });
        tandaiSalah(panel, false);
    }

    const nilaiPilihan = (grup, atribut) => {
        const b = grup.querySelector('button.selected');
        return b ? (atribut ? b.dataset[atribut] : b.textContent.trim()) : null;
    };

    function perbaruiHitung() {
        const n = E.deskripsi.value.length;
        E.hitung.textContent = `${n} / ${DESK_MAX}`;
        tandaiSalah(E.panelDeskripsi, false);
    }

    function validasi() {
        const deskripsi = E.deskripsi.value.trim();
        const cek = [
            [!!state.foto, E.panelFoto, 'Tambahkan foto bukti kerusakan terlebih dahulu.'],
            [!!state.titik, E.kartuLokasi, 'Tentukan lokasi: aktifkan GPS atau ketuk titik di peta.'],
            [!!nilaiPilihan(E.kategori), E.panelKategori, 'Pilih jenis masalah.'],
            [!!nilaiPilihan(E.tingkat, 'tingkat'), E.panelTingkat, 'Pilih tingkat kerusakan.'],
            [deskripsi.length >= DESK_MIN && deskripsi.length <= DESK_MAX, E.panelDeskripsi,
                `Deskripsi harus ${DESK_MIN}–${DESK_MAX} karakter (sekarang ${deskripsi.length}).`]
        ];
        let pertama = null;
        cek.forEach(([ok, panel, pesan]) => {
            tandaiSalah(panel, !ok);
            if (!ok && !pertama) pertama = { panel, pesan };
        });
        return pertama ? { ok: false, ...pertama } : { ok: true, deskripsi };
    }

    function pesanGalat(err) {
        const m = String((err && err.message) || '').toLowerCase();
        const kode = String((err && (err.code || err.statusCode)) || '');

        if (m.includes('bucket not found')) return `Bucket "${BUCKET}" belum dibuat. Jalankan sql/setup-laporan-baru.sql di Supabase.`;
        if (kode === '413' || m.includes('maximum allowed size') || m.includes('too large')) return 'Ukuran foto melebihi batas 5 MB.';
        if (m.includes('mime type') || m.includes('not supported')) return 'Format foto tidak diizinkan. Gunakan JPG, PNG, atau WebP.';
        if (kode === 'P0001') return err.message;                                   // pesan dari trigger validasi di database
        if (kode === '42501' || m.includes('row-level security') || m.includes('unauthorized'))
            return 'Akses ditolak oleh kebijakan database. Pastikan sql/setup-laporan-baru.sql sudah dijalankan di Supabase dan Anda masih login.';
        if (kode === '23514' || m.includes('violates check constraint'))
            return m.includes('status_check')
                ? 'Nilai status ditolak aturan database (laporan_jalan_status_check). Jalankan sql/perbaiki-status-check.sql di Supabase.'
                : 'Data ditolak oleh aturan database: ' + (err.message || '');
        if (kode === '23502' || m.includes('not-null constraint'))
            return 'Ada kolom wajib di tabel yang belum terisi. Detail: ' + (err.message || '');
        if (kode === 'PGRST205' || kode === '42P01') return `Tabel "${TABEL}" belum ada. Jalankan sql/setup-laporan-baru.sql di Supabase.`;
        if (kode === 'PGRST204' || kode === '42703')
            return 'Nama kolom tabel tidak cocok dengan aplikasi. Periksa objek KOLOM di js/uploadLaporan.js. Detail: ' + (err.message || '');
        if (m.includes('jwt') || m.includes('expired')) return 'Sesi login berakhir. Silakan masuk kembali.';
        if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.';
        return 'Gagal mengirim laporan: ' + ((err && err.message) || 'terjadi kesalahan.');
    }

    function setTombol(teks) {
        E.kirim.disabled = !!teks;
        E.kirim.textContent = teks || 'Konfirmasi Laporan';
    }

    async function kirim() {
        if (state.kirim) return;
        tampilPesan('');

        const v = validasi();
        if (!v.ok) {
            tampilPesan(v.pesan, 'err');
            if (v.panel && v.panel.scrollIntoView) v.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        state.kirim = true;
        let pathFoto = null, berhasil = false;
        try {
            setTombol('Memeriksa sesi…');
            const sesi = await window.KK.ambilSesi();
            if (!sesi) { window.location.replace(HALAMAN_LOGIN); return; }
            const uid = sesi.user.id;

            setTombol('Mengunggah foto…');
            pathFoto = `${uid}/${Date.now()}-${acak()}.jpg`;
            const up = await db.storage.from(BUCKET).upload(pathFoto, state.foto.blob, {
                contentType: 'image/jpeg', cacheControl: '31536000', upsert: false
            });
            if (up.error) { pathFoto = null; throw up.error; }
            const { data: pub } = db.storage.from(BUCKET).getPublicUrl(pathFoto);

            setTombol('Menyimpan laporan…');
            const baris = {
                [KOLOM.user_id]: uid,
                [KOLOM.kategori]: nilaiPilihan(E.kategori),
                [KOLOM.tingkat]: nilaiPilihan(E.tingkat, 'tingkat'),
                [KOLOM.deskripsi]: v.deskripsi,
                [KOLOM.alamat]: state.alamat || `${angka2(state.titik.lat)}, ${angka2(state.titik.lon)}`,
                [KOLOM.lat]: Number(state.titik.lat.toFixed(6)),
                [KOLOM.lng]: Number(state.titik.lon.toFixed(6)),
                [KOLOM.foto_url]: pub.publicUrl,
                [KOLOM.status]: STATUS_AWAL
            };
            const { data, error } = await db.from(TABEL).insert(baris).select(KOLOM.kode).single();
            if (error) throw error;

            berhasil = true;
            hentikanGps();
            setTombol('Laporan terkirim ✓');
            const kode = data && data[KOLOM.kode];
            window.location.href = HALAMAN_SUKSES + (kode ? '?kode=' + encodeURIComponent(kode) : '');
        } catch (err) {
            console.error('[uploadLaporan]', err);
            // Laporan gagal tersimpan → jangan tinggalkan foto yatim di Storage
            if (pathFoto) { try { await db.storage.from(BUCKET).remove([pathFoto]); } catch (_) { /* abaikan */ } }
            tampilPesan(pesanGalat(err), 'err');
        } finally {
            if (!berhasil) { state.kirim = false; setTombol(null); }
        }
    }

    /* =================================================================
       INIT
       ================================================================= */
    function pasangEvent() {
        E.kamera.addEventListener('click', () => E.inKamera.click());
        E.galeri.addEventListener('click', () => E.inGaleri.click());
        E.inKamera.addEventListener('change', () => pilihFoto(E.inKamera));
        E.inGaleri.addEventListener('change', () => pilihFoto(E.inGaleri));
        E.fotoHapus.addEventListener('click', hapusFoto);

        E.btnGps.addEventListener('click', () => {
            if (state.mode === 'gps') { hentikanGps(); info('GPS dimatikan. Ketuk peta atau geser pin untuk menyesuaikan titik.'); }
            else mulaiGps(false);
        });

        E.kategori.addEventListener('click', e => { const b = e.target.closest('button'); if (b) pilihOpsi(E.kategori, b, E.panelKategori); });
        E.tingkat.addEventListener('click', e => { const b = e.target.closest('button'); if (b) pilihOpsi(E.tingkat, b, E.panelTingkat); });

        E.deskripsi.addEventListener('input', perbaruiHitung);
        E.kirim.addEventListener('click', kirim);
        window.addEventListener('pagehide', () => { hentikanGps(); if (state.foto) URL.revokeObjectURL(state.foto.url); });
    }

    (async function init() {
        if (!window.db || !window.KK) {
            bukaTampilan();
            tampilPesan('Supabase belum dimuat. Periksa tag <script> di uploadLaporan.html.', 'err');
            E.kirim.disabled = true;
            return;
        }

        const sesi = await window.KK.ambilSesi();
        if (WAJIB_LOGIN && !sesi) { window.location.replace(HALAMAN_LOGIN); return; }
        sesiSaatIni = sesi;
        bukaTampilan();

        db.auth.onAuthStateChange(event => {
            if (WAJIB_LOGIN && event === 'SIGNED_OUT') window.location.replace(HALAMAN_LOGIN);
        });

        E.deskripsi.value = '';                      // jangan kirim teks contoh
        perbaruiHitung();
        pasangEvent();
        tampilkanFoto();

        if (initPeta()) mulaiGps(true);
    })();
})();
