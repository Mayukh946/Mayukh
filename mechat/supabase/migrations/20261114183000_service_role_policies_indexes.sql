-- Keep the public API roles closed; only the trusted server-side service role receives explicit table policies.
create policy service_role_full_access on public.profiles for all to service_role using (true) with check (true);
create policy service_role_full_access on public.devices for all to service_role using (true) with check (true);
create policy service_role_full_access on public.contacts for all to service_role using (true) with check (true);
create policy service_role_full_access on public.groups for all to service_role using (true) with check (true);
create policy service_role_full_access on public.group_members for all to service_role using (true) with check (true);
create policy service_role_full_access on public.messages for all to service_role using (true) with check (true);
create policy service_role_full_access on public.message_deliveries for all to service_role using (true) with check (true);
create policy service_role_full_access on public.statuses for all to service_role using (true) with check (true);
create policy service_role_full_access on public.call_signals for all to service_role using (true) with check (true);
create policy service_role_full_access on public.media_files for all to service_role using (true) with check (true);
create policy service_role_full_access on public.media_access for all to service_role using (true) with check (true);
create policy service_role_full_access on public.rate_limit_buckets for all to service_role using (true) with check (true);
-- Cover referencing columns so deletes/updates and joins remain efficient as the tables grow.
create index call_signals_sender_idx on public.call_signals(sender_id);
create index call_signals_sender_device_idx on public.call_signals(sender_id, sender_device_id);
create index group_members_user_device_idx on public.group_members(user_id, device_id);
create index groups_creator_idx on public.groups(creator_id);
create index media_access_owner_idx on public.media_access(owner_id);
create index messages_sender_device_idx on public.messages(sender_id, sender_device_id);
