// Kirim Masukan -> tabel `masukan` di Supabase
const btn = document.getElementById('kirimMasukan');
const jenis = document.getElementById('jn');
const pesan = document.getElementById('ps');
const status = document.getElementById('msStatus');

function tampil(teks, ok) {
  status.textContent = teks;
  status.style.color = ok ? '#2fa866' : '#d63a3a';
}

// supabaseClient.js menyimpan client di window.db
function getClient() {
  if (window.db && typeof window.db.from === 'function' && window.db.auth) return window.db;
  throw new Error('window.db tidak ada. Pastikan CDN supabase-js dan js/supabaseClient.js dimuat sebelum masukan.js.');
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
