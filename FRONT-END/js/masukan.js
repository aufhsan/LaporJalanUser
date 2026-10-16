// Kirim Masukan -> tabel `masukan` di Supabase
const btn = document.getElementById('kirimMasukan');
const jenis = document.getElementById('jn');
const pesan = document.getElementById('ps');
const status = document.getElementById('msStatus');

function tampil(teks, ok) {
  status.textContent = teks;
  status.style.color = ok ? '#2fa866' : '#d63a3a';
}

// Ambil client Supabase apa pun nama export-nya di supabaseClient.js
async function getClient() {
  const mod = await import('./supabaseClient.js');
  const kandidat = [mod.supabase, mod.default, mod.supabaseClient, mod.client, mod.sb,
    ...Object.values(mod)];
  const client = kandidat.find(c => c && typeof c.from === 'function' && c.auth);
  if (client) return client;
  for (const nama of ['supabaseClient', 'sb', 'db', 'client', 'supabase']) {
    const c = window[nama];
    if (c && typeof c.from === 'function' && c.auth) return c;
  }
  const daftar = Object.keys(mod).join(', ') || '(tidak ada export)';
  throw new Error('Client tidak ditemukan. Export di supabaseClient.js: ' + daftar);
}

btn.addEventListener('click', async () => {
  const isi = pesan.value.trim();
  if (isi.length < 5) return tampil('Pesan minimal 5 karakter.', false);
  if (isi.length > 1000) return tampil('Pesan maksimal 1000 karakter.', false);

  btn.disabled = true;
  btn.textContent = 'Mengirim...';
  tampil('', true);

  try {
    const supabase = await getClient();
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
