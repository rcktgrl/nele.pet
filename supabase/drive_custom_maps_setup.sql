-- Drive Map Editor: custom free-ride maps shared online
create table if not exists drive_custom_maps (
  map_id     text        primary key,
  map_data   jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table drive_custom_maps enable row level security;

-- Anyone can read shared maps
create policy "public_select" on drive_custom_maps
  for select using (true);

-- Anyone can publish / update a map (anonymous sharing)
create policy "public_insert" on drive_custom_maps
  for insert with check (true);

create policy "public_update" on drive_custom_maps
  for update using (true);
