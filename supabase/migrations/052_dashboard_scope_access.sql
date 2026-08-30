-- Dashboard access is limited to the three approved management roles:
--   * System Administrator (via universal `all` permission)
--   * Registrar
--   * Line Supervisor
-- Requisition Officer and Payment/Reconciliation Officer must not receive
-- dashboard.view through their role baseline.

begin;

-- Remove dashboard.view from every role outside the approved dashboard set.
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and rp.permission = 'dashboard.view'
  and r.name not in ('System Administrator', 'Registrar', 'Line Supervisor');

-- Keep explicit dashboard access for Registrar and Line Supervisor.
insert into public.role_permissions (role_id, permission, is_allowed)
select r.id, 'dashboard.view', true
from public.roles r
where r.name in ('Registrar', 'Line Supervisor')
on conflict (role_id, permission)
do update set is_allowed = excluded.is_allowed;

-- System Administrator remains governed by the universal `all` permission.
-- Explicitly ensure Payment/Reconciliation Officer cannot inherit dashboard.view
-- from an earlier baseline.
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.name = 'Payment/Reconciliation Officer'
  and rp.permission = 'dashboard.view';

commit;
