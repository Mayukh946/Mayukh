-- MECHAT production data model. All message payloads remain client-side encrypted.
-- Public client roles receive no table policies; privileged operations run only in the API function.
create table public.profiles (
  user_id text primary key,
  email text not null,
  display_name varchar(80) not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_uq on public.profiles (lower(email));

create table public.devices (
  user_id text not null references public.profiles(user_id) on delete cascade,
  device_id text not null,
  public_key jsonb not null,
  realtime_topic text not null unique,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id)
);
create index devices_user_active_idx on public.devices(user_id, last_seen desc) where revoked_at is null;

create table public.contacts (
  owner_id text not null references public.profiles(user_id) on delete cascade,
  contact_user_id text not null references public.profiles(user_id) on delete cascade,
  email text not null,
  display_name varchar(80) not null default '',
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);
create index contacts_contact_idx on public.contacts(contact_user_id);

create table public.groups (
  id text primary key,
  creator_id text not null references public.profiles(user_id),
  name_ciphertext text not null,
  key_epoch integer not null default 1 check (key_epoch > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id text not null references public.groups(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  device_id text not null,
  role varchar(24) not null default 'member' check (role in ('admin','member')),
  wrapped_key text not null,
  joined_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (group_id, user_id, device_id),
  foreign key (user_id, device_id) references public.devices(user_id, device_id) on delete cascade
);
create index group_members_user_active_idx on public.group_members(user_id, active, group_id);
create index group_members_group_active_idx on public.group_members(group_id, active, user_id);

create table public.messages (
  id text primary key,
  sender_id text not null references public.profiles(user_id),
  sender_device_id text not null,
  conversation_id text not null,
  kind varchar(24) not null default 'text',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  foreign key (sender_id, sender_device_id) references public.devices(user_id, device_id)
);
create index messages_conversation_time_idx on public.messages(conversation_id, created_at desc, id);
create index messages_sender_time_idx on public.messages(sender_id, created_at desc);

create table public.message_deliveries (
  id text primary key,
  message_id text not null references public.messages(id) on delete cascade,
  recipient_id text not null references public.profiles(user_id) on delete cascade,
  recipient_device_id text not null,
  ciphertext text not null,
  nonce text not null,
  delivery_status varchar(16) not null default 'queued' check (delivery_status in ('queued','delivered','seen')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  seen_at timestamptz,
  unique (message_id, recipient_id, recipient_device_id),
  foreign key (recipient_id, recipient_device_id) references public.devices(user_id, device_id) on delete cascade
);
create index deliveries_inbox_idx on public.message_deliveries(recipient_id, recipient_device_id, message_id);
create index deliveries_status_idx on public.message_deliveries(message_id, delivery_status);

create table public.statuses (
  id text primary key,
  user_id text not null references public.profiles(user_id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index statuses_user_expiry_idx on public.statuses(user_id, expires_at desc);
create index statuses_expiry_idx on public.statuses(expires_at);

create table public.call_signals (
  id text primary key,
  call_id text not null,
  sender_id text not null references public.profiles(user_id) on delete cascade,
  sender_device_id text not null,
  recipient_id text not null references public.profiles(user_id) on delete cascade,
  recipient_device_id text not null,
  kind varchar(16) not null check (kind in ('offer','answer','ice','hangup','reject')),
  payload text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (sender_id, sender_device_id) references public.devices(user_id, device_id) on delete cascade,
  foreign key (recipient_id, recipient_device_id) references public.devices(user_id, device_id) on delete cascade
);
create index call_signals_inbox_idx on public.call_signals(recipient_id, recipient_device_id, expires_at);

create table public.media_files (
  id text primary key,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  conversation_id text not null,
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  mime_type text not null default 'application/octet-stream',
  status varchar(16) not null default 'pending' check (status in ('pending','uploaded','failed')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  expires_at timestamptz
);
create index media_files_owner_idx on public.media_files(owner_id, created_at desc);

create table public.media_access (
  file_id text not null references public.media_files(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  conversation_id text not null,
  created_at timestamptz not null default now(),
  primary key (file_id, user_id)
);
create index media_access_user_idx on public.media_access(user_id, conversation_id);

create table public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.contacts enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.statuses enable row level security;
alter table public.call_signals enable row level security;
alter table public.media_files enable row level security;
alter table public.media_access enable row level security;
alter table public.rate_limit_buckets enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mechat-media', 'MECHAT encrypted media', false, 52428800, array['application/octet-stream'])
on conflict (id) do update
set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/octet-stream'];
