/* =====================================================================
   sebarPin.js — cegah pin peta Leaflet menumpuk (window.KKSebar)
   Pin yang berjarak < JARAK_PX piksel dikelompokkan lalu disebar melingkar
   di sekitar titik pusat kelompok. Dihitung ulang tiap zoom, sehingga makin
   di-zoom makin rapat ke posisi aslinya, dan di zoom maksimum hampir tepat di lokasi.
     KKSebar.atur(map, [marker, ...])   // marker.getLatLng() awal = posisi asli
   ===================================================================== */
(function () {
    'use strict';
    const JARAK_PX = 34;      // pin lebih dekat dari ini dianggap menumpuk
    const RADIUS_MIN = 26;    // jari-jari lingkaran sebaran (px)
    const PER_PIN = 7;        // tambahan jari-jari per pin dalam satu kelompok

    function terapkan(map) {
        const daftar = map._kkSebar || [];
        const z = map.getZoom();
        const titik = daftar.map((m) => map.project(m._asli, z));
        const sudah = new Array(daftar.length).fill(false);

        for (let i = 0; i < daftar.length; i++) {
            if (sudah[i]) continue;
            const grup = [i];
            sudah[i] = true;
            for (let j = i + 1; j < daftar.length; j++) {
                if (!sudah[j] && titik[i].distanceTo(titik[j]) < JARAK_PX) { grup.push(j); sudah[j] = true; }
            }
            if (grup.length === 1) { daftar[i].setLatLng(daftar[i]._asli); continue; }

            const pusat = grup.reduce((a, k) => a.add(titik[k]), L.point(0, 0)).divideBy(grup.length);
            const r = Math.max(RADIUS_MIN, grup.length * PER_PIN);
            grup.forEach((k, n) => {
                const sudut = (2 * Math.PI * n) / grup.length - Math.PI / 2;
                const p = L.point(pusat.x + r * Math.cos(sudut), pusat.y + r * Math.sin(sudut));
                daftar[k].setLatLng(map.unproject(p, z));
            });
        }
    }

    function atur(map, markers) {
        markers.forEach((m) => { if (!m._asli) m._asli = m.getLatLng(); });
        map._kkSebar = markers;
        if (!map._kkSebarPasang) {
            map._kkSebarPasang = true;
            map.on('zoomend', () => terapkan(map));
        }
        terapkan(map);
    }

    window.KKSebar = Object.freeze({ atur });
})();
