-- ADCode quotes advertisers in 500-impression blocks. A $1 block is a $2 CPM
-- internally, and a $0.01 block increment is $0.02 CPM. Existing serve prices are
-- immutable and intentionally remain unchanged; only future auctions use this config.
alter table public.serving_config
  alter column floor_cpm_micros set default 2000000,
  alter column auction_increment_cpm_micros set default 20000;

update public.serving_config
set floor_cpm_micros = 2000000,
    auction_increment_cpm_micros = 20000;

create index if not exists serves_market_history_idx
  on public.serves (served_at)
  where test = false and clearing_cpm_micros > 0;
