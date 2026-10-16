/* =====================================================================
   welcome.js — cek sesi login di welcome.html
     sudah login → dashboard.html
     belum login → tetap di welcome (tombol "Mulai" ke regist.html dan
                   "Masuk" ke login.html), atau langsung ke login.html bila
                   TAMU_LANGSUNG_KE_LOGIN = true
   Butuh: window.db dan window.KK (supabaseClient.js)
   ===================================================================== */
(function () {
    'use strict';

    const KE_DASHBOARD = 'dashboard.html';
    const KE_LOGIN = 'login.html';

    // false: tamu melihat halaman welcome (bisa memilih daftar atau masuk).
    // true : tamu langsung dialihkan ke login.html; halaman welcome tidak pernah tampil.
    const TAMU_LANGSUNG_KE_LOGIN = false;

    // Penutup sementara (<style id="kk-guard"> di <head>) agar halaman tidak berkedip
    const guard = document.getElementById('kk-guard');
    const bukaTampilan = () => { if (guard) guard.remove(); };
    setTimeout(bukaTampilan, 3000);                  // jaring pengaman bila Supabase lambat/gagal dimuat

    (async function () {
        try {
            if (!window.db || !window.KK) return;    // library gagal dimuat: tampilkan welcome apa adanya

            const sesi = await window.KK.ambilSesi();
            if (sesi) { window.location.replace(KE_DASHBOARD); return; }
            if (TAMU_LANGSUNG_KE_LOGIN) { window.location.replace(KE_LOGIN); return; }
        } catch (err) {
            console.error(err);
        }
        bukaTampilan();
    })();
})();
