-- =====================================================================
-- sistem-poin.sql — sistem poin KotaKita (sesuai "Cara dapat Poin")
--   +10  Kirim Laporan Valid               → saat laporan masuk
--   +15  Laporan Dikonfirmasi Admin/Mitra  → saat status menjadi diverifikasi/dikonfirmasi
--   +25  Laporan Selesai Ditangani         → saat status menjadi selesai
-- Jalankan di Supabase → SQL Editor. Aman dijalankan berulang.
-- Poin dihitung SERVER-SIDE lewat trigger (klien tidak bisa menambah poin sendiri).
-- Setiap laporan hanya bisa memberi tiap jenis poin satu kali (unique laporan+jenis).
-- Laporan 'ditolak' tidak memberi +15/+25. Laporan yang dihapus/ditarik sebelum dikonfirmasi kehilangan poinnya.
-- =====================================================================

-- 1) Buku besar poin
create table if not exists public.poin_riwayat (
    id          bigint generated always as identity primary key,
    user_id     uuid        not null,
    laporan_ref text        not null,              -- kode laporan (atau id bila kode kosong)
    jenis       text        not null check (jenis in ('kirim', 'konfirmasi', 'selesai')),
    poin        integer     not null check (poin > 0),
    keterangan  text        not null,
    created_at  timestamptz not null default now(),
    unique (laporan_ref, jenis)
);
create index if not exists poin_riwayat_user_idx on public.poin_riwayat (user_id, created_at desc);

alter table public.poin_riwayat enable row level security;
drop policy if exists poin_riwayat_baca_sendiri on public.poin_riwayat;
create policy poin_riwayat_baca_sendiri on public.poin_riwayat
    for select to authenticated using (user_id = auth.uid());
-- Sengaja TIDAK ada policy insert/update/delete: hanya trigger (security definer) yang menulis.
revoke insert, update, delete on public.poin_riwayat from anon, authenticated;

-- 2) Pemberi poin (dipanggil trigger & backfill)
create or replace function public.beri_poin(p_user uuid, p_ref text, p_jenis text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_poin int;
    v_ket  text;
begin
    if p_user is null or p_ref is null then return; end if;
    if p_jenis = 'kirim' then
        v_poin := 10; v_ket := 'Kirim laporan valid';
    elsif p_jenis = 'konfirmasi' then
        v_poin := 15; v_ket := 'Laporan dikonfirmasi admin/mitra';
    elsif p_jenis = 'selesai' then
        v_poin := 25; v_ket := 'Laporan selesai ditangani';
    else
        return;
    end if;
    insert into public.poin_riwayat (user_id, laporan_ref, jenis, poin, keterangan)
    values (p_user, p_ref, p_jenis, v_poin, v_ket || ' · ' || p_ref)
    on conflict (laporan_ref, jenis) do nothing;
end;
$$;
revoke all on function public.beri_poin(uuid, text, text) from public, anon, authenticated;

-- 3) Tahap status → jenis poin yang sudah layak diterima
create or replace function public.tahap_poin(p_status text)
returns int   -- 0 = belum/ditolak, 1 = terkonfirmasi, 2 = selesai
language sql immutable
as $$
    select case lower(trim(coalesce(p_status, '')))
        when 'selesai' then 2
        when 'diverifikasi' then 1 when 'terverifikasi' then 1 when 'dikonfirmasi' then 1
        when 'diproses' then 1 when 'proses' then 1 when 'dikerjakan' then 1
        else 0
    end;
$$;

-- 4) Trigger pada laporan_jalan
create or replace function public.trg_poin_laporan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    j   jsonb;
    ref text;
    t   int;
begin
    if tg_op = 'DELETE' then
        j := to_jsonb(old);
        ref := coalesce(j->>'kode', j->>'id');
        -- laporan yang belum dikonfirmasi dihapus/ditarik (mis. spam): poinnya dicabut.
        -- laporan yang sudah dikonfirmasi/selesai tetap mempertahankan poin yang sudah diterima.
        if public.tahap_poin(old.status) = 0 then
            delete from public.poin_riwayat where laporan_ref = ref and user_id = old.user_id;
        end if;
        return old;
    end if;

    j := to_jsonb(new);
    ref := coalesce(j->>'kode', j->>'id');

    if tg_op = 'INSERT' then
        perform public.beri_poin(new.user_id, ref, 'kirim');
        t := public.tahap_poin(new.status);
    else
        if new.status is not distinct from old.status then return new; end if;
        t := public.tahap_poin(new.status);
    end if;

    if t >= 1 then perform public.beri_poin(new.user_id, ref, 'konfirmasi'); end if;
    if t >= 2 then perform public.beri_poin(new.user_id, ref, 'selesai');    end if;
    return new;
end;
$$;

drop trigger if exists poin_laporan_ins on public.laporan_jalan;
create trigger poin_laporan_ins after insert on public.laporan_jalan
    for each row execute function public.trg_poin_laporan();
drop trigger if exists poin_laporan_upd on public.laporan_jalan;
create trigger poin_laporan_upd after update of status on public.laporan_jalan
    for each row execute function public.trg_poin_laporan();
drop trigger if exists poin_laporan_del on public.laporan_jalan;
create trigger poin_laporan_del after delete on public.laporan_jalan
    for each row execute function public.trg_poin_laporan();

-- 5) Saldo poin pengguna yang sedang login
create or replace function public.poin_saya()
returns integer
language sql stable security definer
set search_path = public
as $$
    select coalesce(sum(poin), 0)::int from public.poin_riwayat where user_id = auth.uid();
$$;
revoke all on function public.poin_saya() from public, anon;
grant execute on function public.poin_saya() to authenticated;

-- 6) Backfill laporan yang sudah ada sebelum sistem ini dipasang
do $$
declare r record; j jsonb; ref text; t int;
begin
    for r in select * from public.laporan_jalan loop
        j := to_jsonb(r);
        ref := coalesce(j->>'kode', j->>'id');
        t := public.tahap_poin(r.status);
        perform public.beri_poin(r.user_id, ref, 'kirim');
        if t >= 1 then perform public.beri_poin(r.user_id, ref, 'konfirmasi'); end if;
        if t >= 2 then perform public.beri_poin(r.user_id, ref, 'selesai');    end if;
    end loop;
end $$;

-- 7) Nilai status yang dipakai aplikasi pengguna + dashboard admin (admin/index.html)
--    NOT VALID: baris lama tidak diperiksa ulang, hanya baris baru/yang diubah.
alter table public.laporan_jalan drop constraint if exists laporan_jalan_status_check;
alter table public.laporan_jalan add constraint laporan_jalan_status_check
    check (status in ('menunggu','baru','terkirim','dikonfirmasi','diverifikasi','diproses','selesai','ditolak')) not valid;
