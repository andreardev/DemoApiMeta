-- Canales de mensajería de Instagram y Facebook por negocio.
create table if not exists public.meta_channels (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check(channel in ('instagram','facebook')),
  page_id text not null,
  account_id text not null default '',
  display_name text not null default '',
  display_handle text not null default '',
  connected_at timestamptz not null default now(),
  primary key(workspace_id,channel),
  unique(channel,page_id)
);
create table if not exists public.meta_channel_credentials (
  workspace_id uuid not null,
  channel text not null check(channel in ('instagram','facebook')),
  encrypted_token text not null,
  primary key(workspace_id,channel),
  foreign key(workspace_id,channel) references public.meta_channels(workspace_id,channel) on delete cascade
);
alter table public.meta_channels enable row level security;
alter table public.meta_channel_credentials enable row level security;
revoke all on public.meta_channels,public.meta_channel_credentials from anon,authenticated;
grant select on public.meta_channels to authenticated;
grant all on public.meta_channels,public.meta_channel_credentials to service_role;
create policy meta_channels_read on public.meta_channels for select to authenticated using(public.workspace_role(workspace_id) is not null);

create or replace function public.connect_meta_channel(wid uuid,actor uuid,channel_name text,meta_page_id text,meta_account_id text,meta_name text,meta_handle text,ciphertext text) returns void language plpgsql security definer set search_path='' as $$
begin
 if channel_name not in ('instagram','facebook') then raise exception 'Canal Meta no válido.'; end if;
 if not exists(select 1 from public.memberships m join public.workspaces w on w.id=m.workspace_id join public.plans p on p.id=w.plan_id where m.workspace_id=wid and m.user_id=actor and m.role in ('owner','admin') and w.status='active') and not exists(select 1 from public.platform_admins where user_id=actor) then raise exception 'No autorizado para configurar este canal.'; end if;
 insert into public.meta_channels(workspace_id,channel,page_id,account_id,display_name,display_handle) values(wid,channel_name,meta_page_id,coalesce(meta_account_id,''),left(meta_name,120),left(meta_handle,120)) on conflict(workspace_id,channel) do update set page_id=excluded.page_id,account_id=excluded.account_id,display_name=excluded.display_name,display_handle=excluded.display_handle,connected_at=now();
 insert into public.meta_channel_credentials values(wid,channel_name,ciphertext) on conflict(workspace_id,channel) do update set encrypted_token=excluded.encrypted_token;
 insert into public.activity(workspace_id,description) values(wid,'Canal de '||channel_name||' conectado');
end $$;
create or replace function public.disconnect_meta_channel(wid uuid,channel_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.workspace_role(wid),'') not in ('owner','admin') then raise exception 'No autorizado.'; end if;
 delete from public.meta_channels where workspace_id=wid and channel=channel_name;
 insert into public.activity(workspace_id,description) values(wid,'Canal de '||channel_name||' desconectado');
end $$;
create or replace function public.record_meta_inbound(meta_id text,channel_name text,meta_page_id text,sender text,body text,event_time timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from public.meta_channels where channel=channel_name and page_id=meta_page_id;
 if wid is null then return; end if;
 insert into public.messages(workspace_id,provider_id,direction,phone,content,kind,status,created_at) values(wid,meta_id,'inbound',sender,left(body,4096),channel_name,'received',least(event_time,now())) on conflict(provider_id) do nothing;
end $$;
revoke execute on function public.connect_meta_channel(uuid,uuid,text,text,text,text,text,text),public.disconnect_meta_channel(uuid,text) from public,anon;
revoke execute on function public.record_meta_inbound(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.connect_meta_channel(uuid,uuid,text,text,text,text,text,text),public.disconnect_meta_channel(uuid,text),public.record_meta_inbound(text,text,text,text,text,timestamptz) to service_role,authenticated;
