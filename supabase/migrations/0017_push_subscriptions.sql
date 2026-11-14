-- Langganan notifikasi push (Web Push) per perangkat/browser.
create table if not exists push_subscriptions (
  id            serial primary key,
  user_id       text not null references users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
