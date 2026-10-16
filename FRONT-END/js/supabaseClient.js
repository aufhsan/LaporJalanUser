/* =====================================================================
   supabaseClient.js — inisialisasi Supabase untuk seluruh halaman KotaKita
   Pasang SETELAH library supabase-js dan SEBELUM script halaman:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="js/supabaseClient.js"></script>
     <script src="js/login.js"></script>

   Ini script klasik (bukan ES module) supaya tetap jalan saat halaman
   dibuka langsung dari file:// maupun dari server statis.
   ===================================================================== */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ilmnhyyarurqszcyidnx.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsbW5oeXlhcnVycXN6Y3lpZG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1Nzc0MzQsImV4cCI6MjEwNzE1MzQzNH0.sbvZvD_WOHvpTpwy6dc9Kcdql4BLqKjQR10v5VmJrFo';

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('[KotaKita] supabase-js belum dimuat. Pastikan <script> CDN dipasang sebelum supabaseClient.js.');
        return;
    }

    // Opsi sama dengan LaporJalanUser.html supaya sesi kompatibel antar halaman
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            flowType: 'implicit',
            persistSession: true,       // sesi disimpan di localStorage, dibagi antar halaman
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    // Helper bersama
    const ambilSesi = async () => {
        const { data, error } = await db.auth.getSession();
        return error ? null : data.session;
    };

    window.db = db;
    window.KK = Object.freeze({ SUPABASE_URL, ambilSesi });
})();
