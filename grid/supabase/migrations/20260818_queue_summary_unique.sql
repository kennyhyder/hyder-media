-- grid_queue_summary lacked the UNIQUE(iso, poi_name) its writers assumed, so
-- refresh-interconnection-queues.py's merge-duplicates upsert silently INSERTED
-- duplicates (the map overlay sums per-ISO, so dups double-count). Added
-- 2026-08-18 alongside the rewrite to the open-source gridstatus feed, which now
-- does per-ISO delete+replace of per-state <STATE>_aggregate rows.
alter table grid_queue_summary
  add constraint grid_queue_summary_iso_poi_uniq unique (iso, poi_name);
