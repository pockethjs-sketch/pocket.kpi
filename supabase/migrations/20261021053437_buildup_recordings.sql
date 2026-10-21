-- Buildup meeting recordings: private audio storage and precise transcription jobs (server-only).
-- Audio files live in the private Storage bucket `buildup-audio` (no public access, no browser policies);
-- kpi-buildup-api hands out short-lived signed URLs only after the verified employee + ACTIVE membership checks.
-- Employees upload and transcribe only their own recordings; OWNER/ADMIN read access is enforced in the function.
-- Transcription results arrive through kpi-buildup-stt-callback, authenticated by a single-use per-recording secret
-- whose SHA-256 is stored in callback_hash and cleared on use.

create table if not exists public.buildup_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  project_id text not null,
  audio_key text not null,
  storage_path text not null,
  mime text not null,
  bytes bigint not null default 0,
  duration_sec integer not null default 0,
  status text not null default 'uploading',
  stt_provider text,
  stt_token text,
  callback_hash text,
  speakers smallint,
  error_code text,
  result jsonb,
  requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buildup_recordings_audio_unique unique (organization_id, owner_user_id, project_id, audio_key),
  constraint buildup_recordings_path_unique unique (storage_path),
  constraint buildup_recordings_formats check (
    project_id ~ '^[A-Za-z0-9_-]{1,80}$' and audio_key ~ '^[A-Za-z0-9_-]{1,120}$'
    and char_length(storage_path) between 1 and 400 and char_length(mime) between 1 and 40),
  constraint buildup_recordings_sizes check (bytes >= 0 and duration_sec between 0 and 86400),
  constraint buildup_recordings_status check (status in ('uploading', 'uploaded', 'processing', 'done', 'failed')),
  constraint buildup_recordings_stt check (
    (stt_provider is null or stt_provider = 'clova')
    and (stt_token is null or char_length(stt_token) <= 200)
    and (callback_hash is null or callback_hash ~ '^[0-9a-f]{64}$')
    and (speakers is null or speakers between 0 and 10)
    and (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$')),
  constraint buildup_recordings_result_object check (result is null or jsonb_typeof(result) = 'object')
);

create index if not exists buildup_recordings_owner_requests
  on public.buildup_recordings (organization_id, owner_user_id, requested_at desc);

alter table public.buildup_recordings enable row level security;
alter table public.buildup_recordings force row level security;
revoke all on public.buildup_recordings from anon, authenticated;
grant select, insert, update on public.buildup_recordings to service_role;

comment on table public.buildup_recordings is
  'Buildup meeting recordings (private Storage bucket buildup-audio) and CLOVA Speech precise-transcription jobs. Server-only: kpi-buildup-api validates employee session and membership; owners write their own rows, OWNER/ADMIN read all. Results via kpi-buildup-stt-callback with a single-use hashed secret.';

-- Private bucket; no storage.objects policies are added, so browser roles cannot list, read or write it.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('buildup-audio', 'buildup-audio', false, array[
  'audio/webm', 'video/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'video/mp4',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac', 'audio/flac'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
