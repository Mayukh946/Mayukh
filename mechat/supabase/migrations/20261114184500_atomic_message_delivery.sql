-- Atomically persist one message, all per-device encrypted copies and attachment permissions.
create or replace function public.mechat_send_message(
  p_message jsonb,
  p_deliveries jsonb,
  p_media_file_id text default null,
  p_media_users text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := p_message->>'id';
  v_sender text := p_message->>'sender_id';
  v_conversation text := p_message->>'conversation_id';
  v_count integer := 0;
begin
  if v_id is null or v_sender is null or v_conversation is null or jsonb_typeof(p_deliveries) <> 'array' then
    raise exception 'invalid_message_payload';
  end if;
  if exists (
    select 1 from public.messages
    where id = v_id and (sender_id <> v_sender or conversation_id <> v_conversation)
  ) then
    raise exception 'message_id_conflict';
  end if;
  if p_media_file_id is not null and not exists (
    select 1 from public.media_files
    where id = p_media_file_id and owner_id = v_sender
      and conversation_id = v_conversation and status = 'uploaded'
  ) then
    raise exception 'media_not_ready_or_not_owned';
  end if;
  insert into public.messages (id, sender_id, sender_device_id, conversation_id, kind, created_at)
  values (v_id, v_sender, p_message->>'sender_device_id', v_conversation,
          coalesce(p_message->>'kind', 'text'),
          coalesce((p_message->>'created_at')::timestamptz, pg_catalog.now()))
  on conflict (id) do nothing;
  insert into public.message_deliveries
    (id, message_id, recipient_id, recipient_device_id, ciphertext, nonce, delivery_status)
  select x.id, x.message_id, x.recipient_id, x.recipient_device_id,
         x.ciphertext, x.nonce, coalesce(x.delivery_status, 'queued')
  from pg_catalog.jsonb_to_recordset(p_deliveries) as x(
    id text, message_id text, recipient_id text, recipient_device_id text,
    ciphertext text, nonce text, delivery_status text
  )
  on conflict (id) do nothing;
  get diagnostics v_count = row_count;
  if p_media_file_id is not null then
    insert into public.media_access (file_id, user_id, owner_id, conversation_id)
    select p_media_file_id, recipient, v_sender, v_conversation
    from pg_catalog.unnest(coalesce(p_media_users, array[]::text[])) as recipient
    on conflict (file_id, user_id) do nothing;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'queuedCopies', v_count);
end;
$$;
revoke all on function public.mechat_send_message(jsonb, jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.mechat_send_message(jsonb, jsonb, text, text[]) to service_role;
