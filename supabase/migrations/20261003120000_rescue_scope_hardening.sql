begin;

drop policy if exists rescue_requests_read on public.rescue_requests;
create policy rescue_requests_read on public.rescue_requests
  for select to authenticated using (
    auth.jwt()->>'app_role' in ('admin', 'staff')
    or (auth.jwt()->>'app_role' = 'barangay' and barangay = auth.jwt()->>'barangay')
    or account_id = nullif(auth.jwt()->>'account_id', '')::integer
  );

drop policy if exists rescue_requests_update on public.rescue_requests;
create policy rescue_requests_update on public.rescue_requests
  for update to authenticated using (
    auth.jwt()->>'app_role' in ('admin', 'staff')
    or (auth.jwt()->>'app_role' = 'barangay' and barangay = auth.jwt()->>'barangay')
  ) with check (
    auth.jwt()->>'app_role' in ('admin', 'staff')
    or (auth.jwt()->>'app_role' = 'barangay' and barangay = auth.jwt()->>'barangay')
  );

-- A request's timeline follows the same visibility as its parent request.
drop policy if exists rescue_request_updates_read on public.rescue_request_updates;
create policy rescue_request_updates_read on public.rescue_request_updates
  for select to authenticated using (
    exists (
      select 1 from public.rescue_requests r
      where r.id = request_id
    )
  );

drop policy if exists rescue_request_updates_write on public.rescue_request_updates;
create policy rescue_request_updates_write on public.rescue_request_updates
  for insert to authenticated with check (
    auth.jwt()->>'app_role' in ('admin', 'staff', 'barangay', 'resident')
    and exists (
      select 1 from public.rescue_requests r
      where r.id = request_id
    )
  );

commit;
