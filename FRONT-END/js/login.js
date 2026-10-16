/* =====================================================================
   login.js — penanganan form login (login.html)
   Alur sama dengan backend (LaporJalanUser.html):
     username → rpc('kontak_dari_username') → email/telepon
              → auth.signInWithPassword → dashboard.html
   Butuh: window.db (supabaseClient.js)
   ===================================================================== */
(function () {
    'use strict';

    const TUJUAN_SETELAH_LOGIN = 'dashboard.html';
    const RE_USERNAME = /^[a-z][a-z0-9_.]{3,19}$/;   // sama dengan backend
    const MAKS_GAGAL = 5;
    const KUNCI_MS = 30000;

    const $ = id => document.getElementById(id);
    const form = $('formLogin');
    const inUser = $('username');
    const inPass = $('password');
    const btn = $('btnMasuk');
    const notice = $('loginNotice');
    const labelBtn = btn.querySelector('span');

    let gagalBeruntun = 0;
    let kunciSampai = 0;

    /* ---------- UI helper ---------- */
    function tampilNotice(pesan) {
    notice.classList.remove('is-ok');
    notice.textContent = pesan || '';
    notice.hidden = !pesan;
    }

    function setErr(input, pesan) {
        const el = $('err-' + input.id);
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', el.id);
        el.textContent = pesan;
        el.hidden = false;
    }

    function bersihkan() {
        tampilNotice('');
        [inUser, inPass].forEach(input => {
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-describedby');
            const el = $('err-' + input.id);
            el.textContent = '';
            el.hidden = true;
        });
    }

    function setMemuat(sedang) {
        btn.disabled = sedang;
        labelBtn.textContent = sedang ? 'Memeriksa...' : 'Masuk';
    }

    /* ---------- Pemetaan error ---------- */
    function pesanGalat(err) {
        const m = String((err && err.message) || '').toLowerCase();
        if (m.includes('not confirmed')) return 'Email Anda belum dikonfirmasi. Buka email konfirmasi yang kami kirim, lalu coba masuk lagi.';
        if (err && err.status === 429) return 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.';
        if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.';
        if (m.includes('could not find the function') || (err && err.code === 'PGRST202'))
            return 'Fungsi database "kontak_dari_username" belum dibuat di Supabase. Jalankan file setup SQL terlebih dahulu.';
        return 'Terjadi gangguan: ' + ((err && err.message) || 'coba lagi nanti.');
    }

    /* ---------- Proses login ---------- */
    async function proses(e) {
        e.preventDefault();
        if (btn.disabled) return;
        bersihkan();

        const username = inUser.value.trim().toLowerCase();
        const password = inPass.value;

        let valid = true;
        if (!username) { setErr(inUser, 'Username wajib diisi.'); valid = false; }
        else if (!RE_USERNAME.test(username)) { setErr(inUser, 'Format username tidak valid.'); valid = false; }
        if (!password) { setErr(inPass, 'Kata sandi wajib diisi.'); valid = false; }
        if (!valid) { (form.querySelector('[aria-invalid="true"]') || inUser).focus(); return; }

        if (Date.now() < kunciSampai) {
            tampilNotice(`Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil((kunciSampai - Date.now()) / 1000)} detik.`);
            return;
        }

        setMemuat(true);
        try {
            // 1) username → email/telepon
            const { data: kontak, error: eK } = await db.rpc('kontak_dari_username', { p_username: username });
            if (eK) throw eK;

            // 2) login; pesan sama untuk "username tak dikenal" dan "password salah"
            let hasil = { error: { message: 'Invalid login credentials' } };
            if (kontak) {
                hasil = kontak.includes('@')
                    ? await db.auth.signInWithPassword({ email: kontak, password })
                    : await db.auth.signInWithPassword({ phone: kontak, password });
            }

            if (hasil.error) {
                const m = (hasil.error.message || '').toLowerCase();
                if (m.includes('invalid login credentials') || !kontak) {
                    gagalBeruntun++;
                    if (gagalBeruntun >= MAKS_GAGAL) { kunciSampai = Date.now() + KUNCI_MS; gagalBeruntun = 0; }
                    tampilNotice('Username atau kata sandi salah.');
                    inPass.value = '';
                    inPass.focus();
                } else {
                    tampilNotice(pesanGalat(hasil.error));
                }
                return;
            }

            gagalBeruntun = 0;
            inPass.value = '';
            window.location.href = TUJUAN_SETELAH_LOGIN;
        } catch (err) {
            console.error(err);
            tampilNotice(pesanGalat(err));
        } finally {
            setMemuat(false);
        }
    }

    /* ---------- Init ---------- */
    form.addEventListener('submit', proses);
    [inUser, inPass].forEach(i => i.addEventListener('input', () => {
        if (i.hasAttribute('aria-invalid')) {
            i.removeAttribute('aria-invalid');
            const el = $('err-' + i.id); el.textContent = ''; el.hidden = true;
        }
    }));

    // Pesan dari halaman daftar
    try {
        const raw = sessionStorage.getItem('kk_pesan_login');
        if (raw) {
            sessionStorage.removeItem('kk_pesan_login');
            const p = JSON.parse(raw);
            tampilNotice(p.teks);
            if (p.tipe === 'ok') notice.classList.add('is-ok');
        }
    } catch (_) { /* abaikan */ }
    
    // Sudah login? langsung ke dashboard
    window.KK.ambilSesi().then(s => { if (s) window.location.href = TUJUAN_SETELAH_LOGIN; });
})();
