-- =====================================================================
-- baca-laporan.sql — pendukung halaman:
--   laporanTerkonfirmasi.html, detailLaporan.html, laporan.html, rekamLaporan.html
-- Jalankan di Supabase → SQL Editor. Aman dijalankan berulang.
-- (Asumsi: tabel public.laporan_jalan dan bucket "foto_laporan" sudah ada
--  dari sql/setup-laporan-baru.sql, dan RPC laporan_publik sudah ada.)
-- =====================================================================

-- 1) Pemilik boleh membaca laporannya sendiri
--    (dipakai rekamLaporan.html dan cadangan detailLaporan.html)
drop policy if exists laporan_pemilik_baca on public.laporan_jalan;
create policy laporan_pemilik_baca on public.laporan_jalan
    for select to authenticated
    using (user_id = auth.uid());

-- 2) Detail satu laporan berdasarkan kode (?kode=...)
--    - user_id TIDAK ikut dikirim; diganti penanda milik_saya (true/false)
--    - laporan milik sendiri selalu terbaca; milik orang lain terbaca kecuali berstatus 'ditolak'
--      (ketatkan kondisi di bawah bila daftar publik Anda memakai aturan lain)
create or replace function public.laporan_detail(p_kode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select (to_jsonb(l) - 'user_id')
           || jsonb_build_object('milik_saya', (l.user_id = auth.uid()))
    from public.laporan_jalan l
    where l.kode::text = p_kode
      and (l.user_id = auth.uid() or coalesce(l.status, '') <> 'ditolak')
    limit 1;
$$;

revoke all on function public.laporan_detail(text) from public, anon;
grant execute on function public.laporan_detail(text) to authenticated;

-- 3) OPSIONAL — tombol "Tarik Laporan" di rekamLaporan.html
--    Pemilik hanya boleh menghapus laporannya yang masih berstatus 'menunggu',
--    beserta fotonya di bucket (path foto = <user_id>/<nama-file>).
drop policy if exists laporan_pemilik_tarik on public.laporan_jalan;
create policy laporan_pemilik_tarik on public.laporan_jalan
    for delete to authenticated
    using (user_id = auth.uid() and status = 'menunggu');

drop policy if exists foto_laporan_pemilik_hapus on storage.objects;
create policy foto_laporan_pemilik_hapus on storage.objects
    for delete to authenticated
    using (bucket_id = 'foto_laporan' and (storage.foldername(name))[1] = auth.uid()::text);
