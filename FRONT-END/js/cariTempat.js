/* =====================================================================
   cariTempat.js — kotak cari "jalan atau daerah" di peta (window.KKCari)
   Mencari tempat (Nominatim/OpenStreetMap) yang dibatasi ke area kota tempat pengguna
   berada saat ini, menampilkan saran, lalu menggeser peta ke tempat yang dipilih.
     KKCari.pasang({ input, map, pusat: () => [lat,lng], onPilih: () => {} })
   ===================================================================== */
(function () {
    'use strict';
    const SETENGAH_DERAJAT = 0.25;      // ±0.25° ≈ 28 km: area pencarian di sekitar kota pengguna
    const MIN_HURUF = 3;
    const JEDA = 450;                   // ms, menghormati batas 1 permintaan/detik Nominatim

    const css = `
    .kk-sugest { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 1200; margin: 0; padding: 6px; list-style: none;
        background: #fff; border-radius: 18px; box-shadow: 0 6px 20px rgba(9,46,109,.22); max-height: 280px; overflow-y: auto; }
    .kk-sugest li { padding: 9px 14px; border-radius: 12px; cursor: pointer; line-height: 1.3; }
    .kk-sugest li:hover, .kk-sugest li.aktif { background: #e8f0fc; }
    .kk-sugest b { display: block; font-size: 14px; color: #092e6d; }
    .kk-sugest small { display: block; font-size: 12px; color: #5b6b8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kk-sugest .kk-sugest-info { cursor: default; color: #5b6b8a; font-size: 13px; }
    .kk-sugest .kk-sugest-info:hover { background: transparent; }`;

    function pasang(opt) {
        const { input, map } = opt;
        if (!input || !map || !window.L) return;
        const st = document.createElement('style'); st.textContent = css; document.head.append(st);

        const kotak = input.closest('.search') || input.parentElement;
        kotak.style.position = 'relative';
        const daftar = document.createElement('ul');
        daftar.className = 'kk-sugest'; daftar.hidden = true; daftar.setAttribute('role', 'listbox');
        kotak.append(daftar);

        let timer = null, seq = 0, hasil = [], aktif = -1, penanda = null;

        const kotaTersimpan = () => { try { return JSON.parse(localStorage.getItem('kk:kota') || 'null'); } catch (e) { return null; } };
        function setPlaceholder() {
            const k = kotaTersimpan();
            input.placeholder = k ? `Cari jalan atau daerah di ${k}` : 'Cari jalan atau daerah';
        }
        setPlaceholder();
        setTimeout(setPlaceholder, 3000);   // setelah nama kota terdeteksi

        function info(teks) {
            daftar.textContent = '';
            const li = document.createElement('li'); li.className = 'kk-sugest-info'; li.textContent = teks;
            daftar.append(li); daftar.hidden = false;
        }
        const tutup = () => { daftar.hidden = true; aktif = -1; };

        function gambar() {
            daftar.textContent = '';
            hasil.forEach((h, i) => {
                const li = document.createElement('li'); li.setAttribute('role', 'option');
                const b = document.createElement('b'); b.textContent = h.judul;
                const s = document.createElement('small'); s.textContent = h.ket;
                li.append(b, s);
                li.addEventListener('mousedown', (e) => { e.preventDefault(); pilih(i); });
                daftar.append(li);
            });
            daftar.hidden = !hasil.length;
        }

        function pilih(i) {
            const h = hasil[i]; if (!h) return;
            tutup();
            input.value = h.judul;
            if (penanda) map.removeLayer(penanda);
            penanda = L.marker([h.lat, h.lon], { title: h.judul, zIndexOffset: 900 }).addTo(map)
                .bindPopup(`<b>${esc(h.judul)}</b><br><small>${esc(h.ket)}</small>`).openPopup();
            if (h.bbox) map.flyToBounds(h.bbox, { maxZoom: 17, padding: [30, 30], duration: 0.8 });
            else map.flyTo([h.lat, h.lon], 16, { duration: 0.8 });
            if (opt.onPilih) opt.onPilih(h);
        }
        const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        async function cari(q) {
            const mine = ++seq;
            const p = (opt.pusat && opt.pusat()) || map.getCenter();
            const lat = p.lat != null ? p.lat : p[0], lon = p.lng != null ? p.lng : (p.lon != null ? p.lon : p[1]);
            const vb = [lon - SETENGAH_DERAJAT, lat + SETENGAH_DERAJAT, lon + SETENGAH_DERAJAT, lat - SETENGAH_DERAJAT].join(',');
            info('Mencari…');
            try {
                const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=id&accept-language=id'
                    + '&viewbox=' + vb + '&bounded=1&q=' + encodeURIComponent(q);
                const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 9000);
                const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
                clearTimeout(t);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const j = await r.json();
                if (mine !== seq) return;               // permintaan lama diabaikan
                hasil = j.map((x) => {
                    const bagian = String(x.display_name || '').split(',').map((s) => s.trim());
                    const bb = x.boundingbox ? [[+x.boundingbox[0], +x.boundingbox[2]], [+x.boundingbox[1], +x.boundingbox[3]]] : null;
                    return { judul: x.name || bagian[0], ket: bagian.slice(1, 4).join(', '), lat: +x.lat, lon: +x.lon, bbox: bb };
                }).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
                aktif = -1;
                if (!hasil.length) { const k = kotaTersimpan(); info(`Tidak ditemukan${k ? ' di sekitar ' + k : ''}. Coba nama jalan atau daerah lain.`); }
                else gambar();
            } catch (e) {
                if (mine !== seq) return;
                console.warn('[cari]', e.message);
                info('Pencarian gagal. Periksa koneksi lalu coba lagi.');
            }
        }

        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < MIN_HURUF) { seq++; hasil = []; tutup(); if (!q && penanda) { map.removeLayer(penanda); penanda = null; } return; }
            timer = setTimeout(() => cari(q), JEDA);
        });
        input.addEventListener('keydown', (e) => {
            const li = daftar.querySelectorAll('li[role="option"]');
            if (e.key === 'ArrowDown' && li.length) { e.preventDefault(); aktif = (aktif + 1) % li.length; }
            else if (e.key === 'ArrowUp' && li.length) { e.preventDefault(); aktif = (aktif - 1 + li.length) % li.length; }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (hasil.length) pilih(aktif >= 0 ? aktif : 0);
                else if (input.value.trim().length >= MIN_HURUF) { clearTimeout(timer); cari(input.value.trim()); }
                return;
            } else if (e.key === 'Escape') { tutup(); return; } else return;
            li.forEach((x, i) => x.classList.toggle('aktif', i === aktif));
        });
        input.addEventListener('blur', () => setTimeout(tutup, 150));
        input.addEventListener('focus', () => { if (hasil.length) daftar.hidden = false; });
    }

    window.KKCari = Object.freeze({ pasang });
})();
