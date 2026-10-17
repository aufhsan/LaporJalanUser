/* =====================================================================
   regist.js — pendaftaran user baru (regist.html)
   Alur (sama dengan backend LaporJalanUser.html):
     validasi → rpc('username_tersedia') → auth.signUp → login.html
   Butuh: window.db (supabaseClient.js)
   ===================================================================== */
(function () {
    'use strict';

    const HALAMAN_LOGIN = 'login.html';
    const KUNCI_PESAN_LOGIN = 'kk_pesan_login';

    const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const RE_USERNAME = /^[a-z][a-z0-9_.]{3,19}$/;
    const RE_NAMA = /^[\p{L}][\p{L}\s.'-]{1,59}$/u;

    const $ = id => document.getElementById(id);
    const form = $('formRegist');
    const btn = $('btnLanjut');
    const notice = $('registNotice');
    const F = {
        contact: $('contact'), name: $('name'), birthdate: $('birthdate'),
        city: $('city'), username: $('username'), password: $('password')
    };

    /* ---------- Validasi ---------- */
    function normalisasiTelp(s) {
        const d = String(s).replace(/[\s\-().]/g, '');
        const m = /^(?:\+62|62|0)(8[1-9][0-9]{7,10})$/.exec(d);
        return m ? '+62' + m[1] : null;
    }

    // Nilai <input type="date"> sudah "YYYY-MM-DD" (atau "" bila kosong/tidak lengkap).
    // Cek ulang: format benar dan tanggalnya nyata (bukan 31 Februari, dst).
    function tglValid(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
        if (!m) return false;
        const [y, mo, d] = [+m[1], +m[2], +m[3]];
        const t = new Date(y, mo - 1, d);
        return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d;
    }

    // Jaminan terakhir sebelum signUp: kembalikan "YYYY-MM-DD" valid, atau null.
    // Tahun harus 4 digit (date input bisa menghasilkan tahun 5+ digit) dan tanggal harus nyata.
    function pastikanISO(v) {
        const t = String(v == null ? '' : v).trim();
        return tglValid(t) ? t : null;
    }

    // Tanggal lokal "YYYY-MM-DD" (hindari geser zona waktu dari toISOString)
    function isoLokal(t) {
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }

    function umurDari(iso) {
        const t = new Date(iso + 'T00:00:00');
        if (isNaN(t)) return null;
        const now = new Date();
        let umur = now.getFullYear() - t.getFullYear();
        const m = now.getMonth() - t.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < t.getDate())) umur--;
        return umur;
    }

    function cekPassword(p) {
        if (p.length < 8) return 'Kata sandi minimal 8 karakter.';
        if (p.length > 72) return 'Kata sandi maksimal 72 karakter.';
        if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Kata sandi harus mengandung huruf dan angka.';
        return null;
    }

    /* ---------- UI helper ---------- */
    function tampilNotice(teks, tipe) {
        notice.textContent = teks || '';
        notice.className = 'registration__notice' + (tipe === 'ok' ? ' is-ok' : '');
        notice.hidden = !teks;
    }

    // tipe: 'err' | 'ok'
    function setMsg(input, teks, tipe) {
        const el = $('err-' + input.id);
        el.textContent = teks || '';
        el.className = tipe === 'ok' ? 'registration__ok' : 'registration__error';
        el.hidden = !teks;
        if (teks && tipe !== 'ok') {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', el.id);
        } else {
            input.removeAttribute('aria-invalid');
            if (!teks) input.removeAttribute('aria-describedby');
        }
    }

    function bersihkan() {
        tampilNotice('');
        Object.values(F).forEach(i => setMsg(i, ''));
    }

    function setMemuat(sedang) {
        btn.disabled = sedang;
        btn.textContent = sedang ? 'Menyimpan...' : 'Lanjut';
    }

    /* ---------- Pemetaan error signUp ---------- */
    function pesanGalatDaftar(err) {
        const m = String((err && err.message) || '').toLowerCase();
        if ((err && err.status === 429) || m.includes('rate limit')) return 'Terlalu banyak percobaan pendaftaran. Coba lagi beberapa saat lagi.';
        if (m.includes('already registered') || m.includes('already been registered')) return 'Email/nomor ini sudah terdaftar. Silakan masuk.';
        if (m.includes('database error') || (err && err.status === 500))
            return 'Server gagal menyimpan akun (error database). Username mungkin sudah dipakai, atau trigger profil bermasalah: jalankan ulang sql/setup-auth.sql lalu cek Supabase → Logs → Auth.';
        if (m.includes('phone') && (m.includes('provider') || m.includes('unsupported') || m.includes('disabled')))
            return 'Pendaftaran dengan nomor telepon belum diaktifkan di server. Gunakan email.';
        if (m.includes('invalid') && m.includes('email')) return 'Format email tidak diterima server.';
        if (m.includes('password')) return 'Kata sandi ditolak server: ' + err.message;
        if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.';
        return 'Pendaftaran gagal: ' + ((err && err.message) || 'coba lagi nanti.');
    }

    function pesanGalatRpc(err) {
        const m = String((err && err.message) || '').toLowerCase();
        if ((err && err.code === 'PGRST202') || m.includes('could not find the function'))
            return 'Fungsi database "username_tersedia" belum dibuat di Supabase. Jalankan sql/setup-auth.sql.';
        return 'Terjadi gangguan: ' + ((err && err.message) || 'periksa koneksi internet.');
    }

    /* ---------- Cek username realtime ---------- */
    let timerUser = null;
    let urutanCek = 0;

    F.username.addEventListener('input', () => {
        clearTimeout(timerUser);
        const v = F.username.value.trim().toLowerCase();
        setMsg(F.username, '');
        if (!v) return;
        if (!RE_USERNAME.test(v)) {
            setMsg(F.username, 'Username 4–20 karakter: huruf kecil, angka, _ atau ., diawali huruf.', 'err');
            return;
        }
        const giliran = ++urutanCek;
        timerUser = setTimeout(async () => {
            const { data, error } = await db.rpc('username_tersedia', { p_username: v });
            if (giliran !== urutanCek || error) return;       // hasil basi / gangguan: abaikan
            if (data === false) setMsg(F.username, 'Username sudah dipakai.', 'err');
            else setMsg(F.username, '✓ Username tersedia', 'ok');
        }, 450);
    });

    /* ---------- Date picker: batas tanggal ---------- */
    (function () {
        const now = new Date();
        F.birthdate.max = isoLokal(now);
        F.birthdate.min = isoLokal(new Date(now.getFullYear() - 120, now.getMonth(), now.getDate()));
    })();

    // Hapus error saat user mengetik ulang (kecuali username, diurus handler di atas)
    ['contact', 'name', 'birthdate', 'city', 'password'].forEach(k =>
        ['input', 'change'].forEach(ev =>
            F[k].addEventListener(ev, () => { if (F[k].hasAttribute('aria-invalid')) setMsg(F[k], ''); })));

    /* ---------- Submit ---------- */
    async function proses(e) {
        e.preventDefault();
        if (btn.disabled) return;
        bersihkan();

        const kontakRaw = F.contact.value.trim();
        const nama = F.name.value.trim().replace(/\s+/g, ' ');
        const tglRaw = F.birthdate.value.trim();
        const kota = F.city.value.trim().replace(/\s+/g, ' ');
        const username = F.username.value.trim().toLowerCase();
        const password = F.password.value;

        let valid = true;
        const salah = (input, pesan) => { setMsg(input, pesan, 'err'); valid = false; };

        let email = null, telp = null;
        if (!kontakRaw) salah(F.contact, 'Email atau nomor telepon wajib diisi.');
        else if (kontakRaw.includes('@')) {
            if (!RE_EMAIL.test(kontakRaw)) salah(F.contact, 'Format email tidak valid.');
            else email = kontakRaw.toLowerCase();
        } else {
            telp = normalisasiTelp(kontakRaw);
            if (!telp) salah(F.contact, 'Nomor telepon tidak valid. Contoh: 08123456789.');
        }

        if (!RE_NAMA.test(nama)) salah(F.name, 'Nama 2–60 karakter, hanya huruf, spasi, titik, apostrof, atau strip.');

        let tglISO = null;
        if (!tglRaw) salah(F.birthdate, 'Tanggal lahir wajib diisi.');
        else if (!tglValid(tglRaw)) salah(F.birthdate, 'Tanggal lahir tidak valid.');
        else {
            tglISO = tglRaw;                       // sudah YYYY-MM-DD, langsung dikirim ke Supabase
            const u = umurDari(tglISO);
            if (u === null) salah(F.birthdate, 'Tanggal lahir tidak valid.');
            else if (u < 0) salah(F.birthdate, 'Tanggal lahir tidak boleh di masa depan.');
            else if (u < 13) salah(F.birthdate, 'Usia minimal 13 tahun untuk mendaftar.');
            else if (u > 120) salah(F.birthdate, 'Tanggal lahir tidak valid.');
        }

        if (kota.length < 2 || kota.length > 60) salah(F.city, 'Kota 2–60 karakter.');
        if (!RE_USERNAME.test(username)) salah(F.username, 'Username 4–20 karakter: huruf kecil, angka, _ atau ., diawali huruf.');
        const pw = cekPassword(password);
        if (pw) salah(F.password, pw);

        if (!valid) { (form.querySelector('[aria-invalid="true"]') || F.contact).focus(); return; }

        setMemuat(true);
        try {
            // 1) username masih bebas?
            const { data: tersedia, error: eU } = await db.rpc('username_tersedia', { p_username: username });
            if (eU) throw eU;
            if (tersedia === false) { salah(F.username, 'Username sudah dipakai.'); F.username.focus(); return; }

            // 2) daftar
            const tglKirim = pastikanISO(tglISO);
            if (!tglKirim) { salah(F.birthdate, 'Tanggal lahir tidak valid.'); F.birthdate.focus(); return; }
            const meta = { username, nama, kota, tgl_lahir: tglKirim };   // tgl_lahir: selalu "YYYY-MM-DD"
            const redirect = new URL(HALAMAN_LOGIN, window.location.href).href;
            const payload = email
                ? { email, password, options: { data: meta, emailRedirectTo: redirect } }
                : { phone: telp, password, options: { data: meta } };

            const { data, error } = await db.auth.signUp(payload);
            if (error) { tampilNotice(pesanGalatDaftar(error), 'err'); return; }

            // Supabase menyamarkan email terdaftar sebagai "sukses" tanpa identitas
            if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                tampilNotice('Email ini sudah terdaftar. Silakan masuk atau gunakan "Lupa Kata Sandi".', 'err');
                return;
            }

            const perluKonfirmasi = !data.session;
            if (data.session) await db.auth.signOut();   // alur: setelah daftar, masuk lewat halaman login

            const teks = perluKonfirmasi && email
                ? 'Akun berhasil dibuat. Kami mengirim email konfirmasi — buka tautannya, lalu masuk dengan username Anda.'
                : 'Akun berhasil dibuat. Silakan masuk dengan username dan kata sandi Anda.';
            try { sessionStorage.setItem(KUNCI_PESAN_LOGIN, JSON.stringify({ tipe: 'ok', teks })); } catch (_) { /* abaikan */ }

            form.reset();
            window.location.href = HALAMAN_LOGIN;
        } catch (err) {
            console.error(err);
            tampilNotice(pesanGalatRpc(err), 'err');
        } finally {
            setMemuat(false);
        }
    }

    form.addEventListener('submit', proses);
})();
