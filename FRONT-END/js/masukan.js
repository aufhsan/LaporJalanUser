// Kirim Masukan -> tabel `masukan` di Supabase
const btn = document.getElementById('kirimMasukan');
const jenis = document.getElementById('jn');
const pesan = document.getElementById('ps');
const status = document.getElementById('msStatus');

function tampil(teks, ok) {
  status.textContent = teks;
  status.style.color = ok ? '#2fa866' : '#d63a3a';
}

// Cari client Supabase yang dibuat js/supabaseClient.js (script biasa, bukan module)
function getClient() {
  const ok = c => c && typeof c.from === 'function' && c.auth;
  // const/let di script biasa tidak masuk window, jadi dicek lewat nama langsung
  const cobaNama = [
    () => supabaseClient, () => sb, () => db, () => client, () => supabaseDb, () => _supabase
  ];
  for (const f of cobaNama) {
    try { const c = f(); if (ok(c)) return c; } catch (e) { /* belum ada */ }
  }
  for (const k of Object.keys(window)) {
    try { if (k !== 'supabase' && ok(window[k])) return window[k]; } catch (e) {}
  }
  throw new Error('Client belum ditemukan. Pastikan CDN supabase-js dan js/supabaseClient.js dimuat sebelum masukan.js.');
}

btn.addEventListener('click', async () => {
  const isi = pesan.value.trim();
  if (isi.length < 5) return tampil('Pesan minimal 5 karakter.', false);
  if (isi.length > 1000) return tampil('Pesan maksimal 1000 karakter.', false);

  btn.disabled = true;
  btn.textContent = 'Mengirim...';
  tampil('', true);

  try {
    const supabase = getClient();
    const { data: { session } } = await supabase.auth.getSession();

    const { error } = await supabase.from('masukan').insert({
      user_id: session?.user?.id ?? null,
      jenis: jenis.value,
      pesan: isi
    });
    if (error) throw error;

    pesan.value = '';
    jenis.selectedIndex = 0;
    tampil('Terima kasih! Masukanmu sudah terkirim.', true);
  } catch (err) {
    console.error('Gagal kirim masukan:', err);
    tampil('Gagal: ' + (err.message || 'coba lagi.'), false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kirim masukan';
  }
});
