-- docs/ops/DAILY-CHECKS.sql — the operator's morning checks (pilot ציקטי, 8.11.2026).
--
-- READ-ONLY. Every statement is a SELECT, and the session is set read-only below,
-- so a stray paste cannot change anything. Run in the Supabase SQL editor (or
-- psql) on the OWNER connection: the tenant role cannot see the ops tables.
-- No e-mail address, phone number or token is ever printed. Restaurants appear
-- by name + id, people only as counts.
--
-- Times are shown in Asia/Jerusalem. Paste the output (not the connection
-- string) into a Claude session when something looks wrong (docs/ops/ALERT-CARD.he.md).

BEGIN READ ONLY;

-- 1. Outbox: notifications that FAILED in the last 24 h, per channel.
--    0 rows = good. last_error is truncated (it can quote a provider message, never a secret).
SELECT channel,
       count(*)                          AS failed_24h,
       max(created_at AT TIME ZONE 'Asia/Jerusalem') AS latest_il,
       left(max(last_error), 120)        AS sample_error
  FROM notifications_outbox
 WHERE status = 'failed' AND created_at > now() - interval '24 hours'
 GROUP BY channel
 ORDER BY failed_24h DESC;

-- 2a. Job queue: jobs that FAILED in the last 24 h, per queue.
SELECT queue, count(*) AS failed_24h, left(max(last_error), 120) AS sample_error
  FROM job_queue
 WHERE status = 'failed' AND finished_at > now() - interval '24 hours'
 GROUP BY queue
 ORDER BY failed_24h DESC;

-- 2b. Job queue: jobs RUNNING for more than 10 minutes (a stuck or killed run).
SELECT id, queue, attempts, max_attempts,
       round(extract(epoch FROM now() - locked_at) / 60) AS running_min
  FROM job_queue
 WHERE status = 'active' AND locked_at < now() - interval '10 minutes'
 ORDER BY locked_at;

-- 3. Invoices still "reading" (ocr_pending) after 10 minutes, per restaurant.
SELECT r.name AS restaurant, i.restaurant_id,
       count(*) AS ocr_pending,
       round(extract(epoch FROM now() - min(i.created_at)) / 60) AS oldest_min
  FROM invoices i JOIN restaurants r ON r.id = i.restaurant_id
 WHERE i.status = 'ocr_pending' AND i.created_at < now() - interval '10 minutes'
 GROUP BY r.name, i.restaurant_id
 ORDER BY oldest_min DESC;

-- 4. Job runner heartbeat: age of the freshest beat (the /api/cron/jobs runner
--    beats every minute; under 180 s = alive, same rule as /api/healthz?jobs=1).
SELECT worker_id,
       round(extract(epoch FROM now() - beat_at)) AS age_sec,
       beat_at AT TIME ZONE 'Asia/Jerusalem'       AS beat_il
  FROM worker_heartbeats
 ORDER BY beat_at DESC
 LIMIT 3;

-- 5. Restaurants created in the last 7 days. An unknown name = ALERT-CARD item 9.
SELECT id, name, created_at AT TIME ZONE 'Asia/Jerusalem' AS created_il
  FROM restaurants
 WHERE created_at > now() - interval '7 days'
 ORDER BY created_at DESC;

-- 6. OCR scans this month, per restaurant (invoices whose reading has finished
--    this calendar month, Israel time), and the billing counter next to it.
WITH month AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem' AS start_utc,
         to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') AS period
)
SELECT r.name AS restaurant, r.id,
       count(i.id) FILTER (WHERE i.ocr_payload IS NOT NULL) AS scans_this_month,
       (SELECT uc.used FROM usage_counters uc, month m
         WHERE uc.billing_account_id = r.billing_account_id
           AND uc.metric = 'ocr_scans' AND uc.period = m.period) AS billing_counter
  FROM restaurants r
  CROSS JOIN month m
  LEFT JOIN invoices i ON i.restaurant_id = r.id AND i.created_at >= m.start_utc
 GROUP BY r.name, r.id, r.billing_account_id
 ORDER BY scans_this_month DESC;

-- 7. Invoices held for a human (needsHumanReview) in the last 7 days, by reason.
--    A doc_kind_* reason means the page was a delivery note or a credit note
--    (תעודת משלוח / זיכוי), NOT a misread: route it, don't "fix the OCR".
--    The reason comes from the reader's payload; older rows only say low
--    confidence / unresolved lines (ocr_payload.raw has no reason field).
SELECT r.name AS restaurant,
       COALESCE(i.ocr_payload -> 'raw' ->> 'reviewReason',
                i.ocr_payload -> 'raw' -> 'reviewReasons' ->> 0,
                CASE WHEN i.ocr_payload -> 'raw' ->> 'ocrFailed' = 'true' THEN 'ocr_failed' END,
                'low_confidence_or_unresolved_lines') AS reason,
       (COALESCE(i.ocr_payload -> 'raw' ->> 'reviewReason',
                 i.ocr_payload -> 'raw' -> 'reviewReasons' ->> 0, '') LIKE 'doc_kind_%') AS not_a_misread,
       count(*) AS invoices
  FROM invoices i JOIN restaurants r ON r.id = i.restaurant_id
 WHERE i.created_at > now() - interval '7 days'
   AND (i.ocr_payload -> 'raw' ->> 'needsHumanReview' = 'true'
        OR i.ocr_payload -> 'raw' ->> 'ocrFailed' = 'true')
 GROUP BY 1, 2, 3
 ORDER BY invoices DESC;

-- 8. Outbox rows DEFERRED (scheduled for later: quiet hours / Shabbat / caps), per channel.
--    Not a failure — they will go out at scheduled_at.
SELECT channel, status, count(*) AS deferred,
       min(scheduled_at AT TIME ZONE 'Asia/Jerusalem') AS next_il
  FROM notifications_outbox
 WHERE scheduled_at > now() AND status IN ('queued', 'sending')
 GROUP BY channel, status
 ORDER BY next_il;

-- 9. Members per restaurant against the plan's seats (limits.seatsPerRestaurant;
--    a subscription override wins). over_seats = true needs a plan change or a removal.
SELECT r.name AS restaurant, r.id,
       count(m.user_id) AS members,
       p.key            AS plan,
       COALESCE((s.overrides ->> 'seatsPerRestaurant')::int,
                (p.limits ->> 'seatsPerRestaurant')::int) AS seats,
       count(m.user_id) > COALESCE((s.overrides ->> 'seatsPerRestaurant')::int,
                                   (p.limits ->> 'seatsPerRestaurant')::int) AS over_seats
  FROM restaurants r
  LEFT JOIN memberships m   ON m.restaurant_id = r.id
  LEFT JOIN subscriptions s ON s.billing_account_id = r.billing_account_id
  LEFT JOIN plans p         ON p.id = s.plan_id
 GROUP BY r.name, r.id, p.key, s.overrides, p.limits
 ORDER BY over_seats DESC NULLS LAST, members DESC;

ROLLBACK;
