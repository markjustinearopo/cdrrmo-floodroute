begin;

-- Pending reports can contain a resident's name, location, photo and remarks.
drop policy if exists flood_reports_read on public.flood_reports;
create policy flood_reports_read on public.flood_reports
  for select to authenticated
  using (
    (auth.jwt()->>'app_role') in ('admin', 'staff')
    or verification_status = 'approved'
    or user_id::text = auth.jwt()->>'account_id'
  );

drop policy if exists flood_report_logs_read on public.flood_report_logs;
create policy flood_report_logs_read on public.flood_report_logs
  for select to authenticated
  using (
    (auth.jwt()->>'app_role') in ('admin', 'staff')
    or exists (
      select 1 from public.flood_reports r
      where r.id = report_id and r.user_id::text = auth.jwt()->>'account_id'
    )
  );

commit;
