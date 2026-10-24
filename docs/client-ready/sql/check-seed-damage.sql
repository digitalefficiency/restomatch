-- READ-ONLY. Paste into Supabase → SQL editor and run. Changes nothing (BEGIN READ ONLY … ROLLBACK).
--
-- Question: did an older seed-demo (before PR #53) pick a REAL tenant as "the demo
-- restaurant"? Old seed-demo took the OLDEST restaurant in the database, deleted its
-- invoices / receipts / match runs / discrepancies / price history / activity, and
-- generated demo invoices (numbers like SH-24121, BR-R-24130) for that tenant's POs.
--
-- Read the result:
--   * row 1 of the first table (oldest restaurant) has is_demo = true  → nothing was touched.
--   * row 1 is NOT demo → that tenant was the target: check its demo_style_invoices
--     (generated demo invoices) and whether its own invoices are missing.
--   * The second table also lists every non-demo tenant created BEFORE the demo
--     restaurant, i.e. any that existed when a full seed (TRUNCATE) or seed-demo ran.
begin read only;

with demo_main as (
  select id, created_at from restaurants where business_id = '514778123' and name = 'כפר הזיתים'
), t as (
  select
    r.id,
    r.name,
    r.business_id,
    r.created_at,
    (r.id in (select id from demo_main)
      or (r.name in ('כפר הזיתים — חיפה', 'כפר הזיתים — ירושלים')
          and r.billing_account_id = (select billing_account_id from restaurants where id in (select id from demo_main)))) as is_demo,
    (select count(*) from invoices i where i.restaurant_id = r.id) as invoices,
    (select count(*) from invoices i where i.restaurant_id = r.id
       and i.invoice_number ~ '^(SH|HK|BR|MF|GD|FS|ST|BA|QD|AC|IN)-(R-)?24[0-9]{3}$') as demo_style_invoices,
    (select count(*) from goods_receipts g where g.restaurant_id = r.id) as goods_receipts,
    (select count(*) from purchase_orders p where p.restaurant_id = r.id) as purchase_orders,
    (select min(i.created_at) from invoices i where i.restaurant_id = r.id) as first_invoice_at,
    (select max(i.created_at) from invoices i where i.restaurant_id = r.id) as last_invoice_at,
    (select count(*) from memberships m join users u on u.id = m.user_id
       where m.restaurant_id = r.id and lower(u.email) not like '%@kfar-hazeitim.test') as real_members
  from restaurants r
)
select row_number() over (order by created_at) as age_rank, * from t order by created_at;

-- Verdict in one line.
select case
  when not exists (select 1 from restaurants) then 'no restaurants at all'
  when (select business_id from restaurants order by created_at limit 1) = '514778123'
    then 'OK: the oldest restaurant is the demo tenant — old seed-demo touched only demo data'
  else 'CHECK: the oldest restaurant is NOT the demo tenant — an old seed-demo run would have replaced its invoices: '
       || (select name || ' (' || id || ')' from restaurants order by created_at limit 1)
end as verdict;

rollback;
