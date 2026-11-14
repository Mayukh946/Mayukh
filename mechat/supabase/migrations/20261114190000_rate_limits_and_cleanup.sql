-- Database-backed throttling for account lookup and scheduled cleanup of expiring data.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.mechat_consume_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := pg_catalog.now();
begin
  if p_limit < 1 or p_window_seconds < 1 or p_bucket_key is null or length(p_bucket_key) > 256 then
    return false;
  end if;
  insert into public.rate_limit_buckets(bucket_key, window_started_at, request_count, updated_at)
  values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update
  set request_count = case
        when public.rate_limit_buckets.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now then 1
        else public.rate_limit_buckets.request_count + 1
      end,
      window_started_at = case
        when public.rate_limit_buckets.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now then v_now
        else public.rate_limit_buckets.window_started_at
      end,
      updated_at = v_now
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.mechat_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mechat_consume_rate_limit(text, integer, integer) to service_role;

create or replace function public.mechat_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.call_signals where expires_at < pg_catalog.now();
  delete from public.statuses where expires_at < pg_catalog.now();
  delete from public.rate_limit_buckets where updated_at < pg_catalog.now() - interval '1 day';
end;
$$;
revoke all on function public.mechat_cleanup() from public, anon, authenticated;
grant execute on function public.mechat_cleanup() to service_role;

select cron.schedule('mechat-cleanup', '*/10 * * * *', 'select public.mechat_cleanup()');
