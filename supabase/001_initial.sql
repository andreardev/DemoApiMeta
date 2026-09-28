-- Nexo: execute once in Supabase SQL Editor on a new database.
create table public.plans (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 2 and 60),
 monthly_messages integer not null check(monthly_messages between 0 and 10000000),
 max_members integer not null check(max_members between 1 and 10000),
 whatsapp boolean not null default true, description text not null default '', created_at timestamptz not null default now()
);
insert into public.plans(name, monthly_messages,max_members,description) values
 ('Inicial',1000,3,'Lo esencial para comenzar'),('Profesional',10000,10,'Más capacidad para tu equipo'),('Empresa',50000,50,'Para una operación de mayor escala');
create table public.platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 80),
 industry text not null default '' check(length(industry)<=80), contact_email text not null default '' check(length(contact_email)<=254),
 plan_id uuid not null references public.plans(id), status text not null default 'active' check(status in ('active','suspended')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.memberships (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null, role text not null check(role in ('owner','admin','agent','viewer')),
 created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create table public.whatsapp_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 phone_number_id text not null unique, waba_id text not null, display_phone text not null,
 verified_name text not null default '', connected_at timestamptz not null default now()
);
-- No authenticated/anonymous access: encrypted tokens are server-only.
create table public.whatsapp_credentials (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade, encrypted_token text not null
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider_id text unique, direction text not null check(direction in ('inbound','outbound')),
 phone text not null, content text not null, kind text not null default 'text',
 status text not null check(status in ('received','sending','accepted','sent','delivered','read','failed','unknown')),
 error_code text, created_at timestamptz not null default now()
);
create index messages_workspace_date on public.messages(workspace_id,created_at desc);
create index messages_window on public.messages(workspace_id,phone,created_at desc) where direction='inbound';
create table public.activity (
 id bigint generated always as identity primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 description text not null, created_at timestamptz not null default now()
);
create index activity_workspace_date on public.activity(workspace_id,created_at desc);
create table public.delivery_events (
 provider_id text not null, status text not null check(status in ('sent','delivered','read','failed')),
 error_code text, primary key(provider_id,status)
);

create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins where user_id=auth.uid());
$$;
create function public.workspace_role(wid uuid) returns text language sql stable security definer set search_path='' as $$
 select case when public.is_platform_admin() then 'owner' else (select m.role from public.memberships m join public.workspaces w on w.id=m.workspace_id where m.workspace_id=wid and m.user_id=auth.uid() and w.status='active') end;
$$;
create function public.can_see_workspace(wid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_platform_admin() or exists(select 1 from public.memberships where workspace_id=wid and user_id=auth.uid());
$$;

alter table public.plans enable row level security;
alter table public.platform_admins enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_credentials enable row level security;
alter table public.messages enable row level security;
alter table public.activity enable row level security;
alter table public.delivery_events enable row level security;
create policy plans_read on public.plans for select to authenticated using (true);
create policy workspaces_read on public.workspaces for select to authenticated using(public.can_see_workspace(id));
create policy members_read on public.memberships for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy connections_read on public.whatsapp_connections for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy messages_read on public.messages for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy activity_read on public.activity for select to authenticated using(public.workspace_role(workspace_id) is not null);
revoke all on public.plans,public.platform_admins,public.workspaces,public.memberships,public.whatsapp_connections,public.whatsapp_credentials,public.messages,public.activity,public.delivery_events from anon,authenticated;
grant select on public.plans,public.workspaces,public.memberships,public.whatsapp_connections,public.messages,public.activity to authenticated;
grant all on public.plans,public.platform_admins,public.workspaces,public.memberships,public.whatsapp_connections,public.whatsapp_credentials,public.messages,public.activity,public.delivery_events to service_role;
grant usage,select on sequence public.activity_id_seq to service_role;

create function public.create_workspace(business_name text, business_industry text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare wid uuid; pid uuid; mail text;
begin
 if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.workspaces where created_by=auth.uid())>=10 then raise exception 'Máximo de 10 negocios por cuenta. Contacta al administrador.'; end if;
 select email into mail from auth.users where id=auth.uid();
 select id into pid from public.plans order by monthly_messages,created_at limit 1;
 insert into public.workspaces(name,industry,plan_id,created_by,contact_email) values(trim(business_name),trim(business_industry),pid,auth.uid(),mail) returning id into wid;
 insert into public.memberships(workspace_id,user_id,email,role) values(wid,auth.uid(),mail,'owner');
 insert into public.activity(workspace_id,description) values(wid,'Negocio creado');
 return wid;
end $$;
create function public.update_workspace(wid uuid,business_name text,business_industry text,business_email text) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.workspace_role(wid),'') not in ('owner','admin') then raise exception 'No tienes permisos para configurar este negocio.'; end if;
 update public.workspaces set name=trim(business_name),industry=trim(business_industry),contact_email=trim(business_email) where id=wid;
 insert into public.activity(workspace_id,description) values(wid,'Configuración del negocio actualizada');
end $$;
create function public.manage_member(wid uuid,member_email text,member_role text,remove_member boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare target uuid; existing_member_role text; cap integer;
begin
 perform 1 from public.workspaces where id=wid for update;
 if coalesce(public.workspace_role(wid),'') not in ('owner','admin') then raise exception 'No tienes permisos para administrar el equipo.'; end if;
 select id into target from auth.users where lower(email)=lower(trim(member_email));
 if target is null then raise exception 'El usuario debe registrarse primero con ese correo.'; end if;
 select role into existing_member_role from public.memberships where workspace_id=wid and user_id=target;
 if existing_member_role='owner' or target=auth.uid() then raise exception 'No puedes modificar al propietario ni tu propio acceso.'; end if;
 if member_role not in ('admin','agent','viewer') then raise exception 'Rol no válido.'; end if;
 if public.workspace_role(wid)='admin' and (member_role='admin' or existing_member_role='admin') then raise exception 'Solo el propietario puede administrar otros administradores.'; end if;
 if remove_member then
   delete from public.memberships where workspace_id=wid and user_id=target;
 else
   select p.max_members into cap from public.workspaces w join public.plans p on p.id=w.plan_id where w.id=wid;
   if existing_member_role is null and (select count(*) from public.memberships where workspace_id=wid)>=cap then raise exception 'Alcanzaste el límite de usuarios del plan.'; end if;
   insert into public.memberships(workspace_id,user_id,email,role) values(wid,target,lower(trim(member_email)),member_role) on conflict(workspace_id,user_id) do update set role=excluded.role;
 end if;
 insert into public.activity(workspace_id,description) values(wid,case when remove_member then 'Acceso eliminado: ' else 'Acceso actualizado: ' end || lower(trim(member_email)));
end $$;
create function public.admin_workspace(wid uuid,pid uuid,new_status text) returns void language plpgsql security definer set search_path='' as $$
declare cap integer;
begin
 if not public.is_platform_admin() then raise exception 'Acceso exclusivo de administración.'; end if;
 perform 1 from public.workspaces where id=wid for update;
 select max_members into cap from public.plans where id=pid;
 if cap is null then raise exception 'Plan inexistente.'; end if;
 if (select count(*) from public.memberships where workspace_id=wid)>cap then raise exception 'Reduce el equipo antes de asignar este plan.'; end if;
 update public.workspaces set plan_id=pid,status=new_status where id=wid;
 insert into public.activity(workspace_id,description) values(wid,'Plan o estado de cuenta actualizado por administración');
end $$;
create function public.save_plan(pid uuid,plan_name text,message_limit integer,member_limit integer,whatsapp_enabled boolean,plan_description text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_admin() then raise exception 'Acceso exclusivo de administración.'; end if;
 -- Serialize plan edits with membership and sending operations using workspace locks.
 perform 1 from public.workspaces where plan_id=pid order by id for update;
 if exists(select 1 from public.memberships m join public.workspaces w on w.id=m.workspace_id where w.plan_id=pid group by m.workspace_id having count(*)>member_limit) then raise exception 'Hay negocios con más usuarios que el límite propuesto.'; end if;
 insert into public.plans(id,name,monthly_messages,max_members,whatsapp,description) values(coalesce(pid,gen_random_uuid()),trim(plan_name),message_limit,member_limit,whatsapp_enabled,left(plan_description,300))
 on conflict(id) do update set name=excluded.name,monthly_messages=excluded.monthly_messages,max_members=excluded.max_members,whatsapp=excluded.whatsapp,description=excluded.description;
end $$;
create function public.workspace_usage(wid uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.messages where workspace_id=wid and public.workspace_role(wid) is not null and direction='outbound' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
$$;

-- Server-only operations. The API checks the bearer identity; these functions check it again.
create function public.connect_whatsapp(wid uuid,actor uuid,phone_id text,business_id text,phone_display text,business_name text,ciphertext text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.workspaces where id=wid for update;
 if not exists(select 1 from public.memberships m join public.workspaces w on w.id=m.workspace_id join public.plans p on p.id=w.plan_id where m.workspace_id=wid and m.user_id=actor and m.role in ('owner','admin') and w.status='active' and p.whatsapp) and not exists(select 1 from public.platform_admins where user_id=actor) then raise exception 'No autorizado o WhatsApp no incluido en tu plan.'; end if;
 insert into public.whatsapp_connections(workspace_id,phone_number_id,waba_id,display_phone,verified_name) values(wid,phone_id,business_id,phone_display,business_name) on conflict(workspace_id) do update set phone_number_id=excluded.phone_number_id,waba_id=excluded.waba_id,display_phone=excluded.display_phone,verified_name=excluded.verified_name,connected_at=now();
 insert into public.whatsapp_credentials values(wid,ciphertext) on conflict(workspace_id) do update set encrypted_token=excluded.encrypted_token;
 insert into public.activity(workspace_id,description) values(wid,'Credenciales de WhatsApp verificadas y guardadas');
end $$;
create function public.disconnect_whatsapp(wid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.workspace_role(wid),'') not in ('owner','admin') then raise exception 'No autorizado.'; end if;
 delete from public.whatsapp_credentials where workspace_id=wid;
 delete from public.whatsapp_connections where workspace_id=wid;
 insert into public.activity(workspace_id,description) values(wid,'WhatsApp desconectado');
end $$;
create function public.reserve_message(wid uuid,actor uuid,request_id uuid,recipient text,body text,message_kind text) returns boolean language plpgsql security definer set search_path='' as $$
declare lim integer; enabled boolean; existing public.messages;
begin
 perform 1 from public.workspaces where id=wid for update;
 if not exists(select 1 from public.workspaces where id=wid and status='active') then raise exception 'Negocio suspendido o inexistente: envío no autorizado.'; end if;
 if not exists(select 1 from public.memberships m join public.workspaces w on w.id=m.workspace_id where m.workspace_id=wid and m.user_id=actor and m.role in ('owner','admin','agent') and w.status='active') and not exists(select 1 from public.platform_admins where user_id=actor) then raise exception 'No autorizado para enviar mensajes.'; end if;
 select * into existing from public.messages where id=request_id;
 if found then
   if existing.workspace_id<>wid or existing.phone<>recipient or existing.content<>body or existing.kind<>message_kind then raise exception 'Identificador de envío ya utilizado.'; end if;
   return false;
 end if;
 select p.monthly_messages,p.whatsapp into lim,enabled from public.workspaces w join public.plans p on p.id=w.plan_id where w.id=wid;
 if enabled is not true then raise exception 'WhatsApp no está incluido en tu plan.'; end if;
 if (select count(*) from public.messages where workspace_id=wid and direction='outbound' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=lim then raise exception 'Alcanzaste el límite mensual de mensajes.'; end if;
 if (select count(*) from public.messages where workspace_id=wid and direction='outbound' and created_at>now()-interval '1 minute')>=30 then raise exception 'Máximo 30 envíos por minuto. Espera un momento.'; end if;
 if not exists(select 1 from public.whatsapp_connections where workspace_id=wid) then raise exception 'Conecta WhatsApp antes de enviar.'; end if;
 if message_kind not in ('text','template') or length(body)>4096 or recipient !~ '^[1-9][0-9]{7,14}$' then raise exception 'Mensaje no válido.'; end if;
 if message_kind='text' and not exists(select 1 from public.messages where workspace_id=wid and phone=recipient and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'Fuera de la ventana de 24 horas: utiliza una plantilla aprobada.'; end if;
 insert into public.messages(id,workspace_id,direction,phone,content,kind,status) values(request_id,wid,'outbound',recipient,body,message_kind,'sending');
 return true;
end $$;
create function public.delivery_rank(value text) returns integer language sql immutable set search_path='' as $$
 select case value when 'read' then 6 when 'delivered' then 5 when 'failed' then 4 when 'sent' then 3 when 'accepted' then 2 else 1 end;
$$;
create function public.finish_message(request_id uuid,meta_id text,result_status text,result_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare best public.delivery_events;
begin
 if meta_id is not null then perform pg_advisory_xact_lock(hashtext(meta_id)); end if;
 select * into best from public.delivery_events where provider_id=meta_id order by public.delivery_rank(status) desc limit 1;
 update public.messages set provider_id=meta_id,status=coalesce(best.status,result_status),error_code=coalesce(best.error_code,result_error) where id=request_id and status in ('sending','unknown');
end $$;
create function public.record_delivery(meta_id text,event_status text,event_error text,phone_id text,business_id text) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 perform pg_advisory_xact_lock(hashtext(meta_id));
 select workspace_id into wid from public.whatsapp_connections where phone_number_id=phone_id and waba_id=business_id;
 if wid is null then return; end if;
 insert into public.delivery_events(provider_id,status,error_code) values(meta_id,event_status,event_error) on conflict do nothing;
 update public.messages set status=event_status,error_code=event_error where provider_id=meta_id and workspace_id=wid and public.delivery_rank(event_status)>public.delivery_rank(status);
end $$;
create function public.record_inbound(meta_id text,phone_id text,business_id text,sender text,body text,message_kind text,event_time timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from public.whatsapp_connections where phone_number_id=phone_id and waba_id=business_id;
 if wid is null then return; end if;
 insert into public.messages(workspace_id,provider_id,direction,phone,content,kind,status,created_at) values(wid,meta_id,'inbound',sender,left(body,4096),message_kind,'received',least(event_time,now())) on conflict(provider_id) do nothing;
end $$;

-- Functions have PUBLIC EXECUTE by default in Postgres; close each explicitly.
revoke execute on function public.is_platform_admin(),public.workspace_role(uuid),public.can_see_workspace(uuid),public.create_workspace(text,text),public.update_workspace(uuid,text,text,text),public.manage_member(uuid,text,text,boolean),public.admin_workspace(uuid,uuid,text),public.save_plan(uuid,text,integer,integer,boolean,text),public.workspace_usage(uuid),public.disconnect_whatsapp(uuid) from public,anon;
grant execute on function public.is_platform_admin(),public.workspace_role(uuid),public.can_see_workspace(uuid),public.create_workspace(text,text),public.update_workspace(uuid,text,text,text),public.manage_member(uuid,text,text,boolean),public.admin_workspace(uuid,uuid,text),public.save_plan(uuid,text,integer,integer,boolean,text),public.workspace_usage(uuid),public.disconnect_whatsapp(uuid) to authenticated;
revoke execute on function public.connect_whatsapp(uuid,uuid,text,text,text,text,text),public.reserve_message(uuid,uuid,uuid,text,text,text),public.delivery_rank(text),public.finish_message(uuid,text,text,text),public.record_delivery(text,text,text,text,text),public.record_inbound(text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.connect_whatsapp(uuid,uuid,text,text,text,text,text),public.reserve_message(uuid,uuid,uuid,text,text,text),public.delivery_rank(text),public.finish_message(uuid,text,text,text),public.record_delivery(text,text,text,text,text),public.record_inbound(text,text,text,text,text,text,timestamptz) to service_role;



