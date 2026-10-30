-- Queue the 9 LinkedIn leads found on 2026-10-29 onto Hugo Vermot's pipeline.
--
-- public.pipeline is the per-account inbox (user_id -> profiles.id / auth.users.id).
-- public.applications is the evaluated tracker and is not written here: these
-- leads have no score and no canonical status.
--
-- Safe to re-run. Rows already processed for this user are left untouched.
-- Other accounts are not updated. Requires the unique (url, user_id)
-- constraint from supabase/schema.sql (pipeline_url_user_id_key).
--
-- Run in the Supabase SQL editor. If the name lookup raises, re-run
-- import-profile-offers.mjs --user-id=<profiles.id> with the service role key.

do $import$
declare
  hugo_id uuid;
  match_count integer;
begin
  select count(distinct p.id)
    into match_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(btrim(coalesce(p.full_name, ''))) = 'hugo vermot'
     or lower(btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) = 'hugo vermot';

  if match_count <> 1 then
    raise exception 'Expected exactly 1 profile named Hugo Vermot, found %. Pass --user-id to import-profile-offers.mjs.', match_count;
  end if;

  select distinct p.id
    into hugo_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(btrim(coalesce(p.full_name, ''))) = 'hugo vermot'
     or lower(btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) = 'hugo vermot';

  insert into public.pipeline (url, note, processed, user_id, created_at)
  select v.url, v.note, false, hugo_id, timestamptz '2026-10-29 12:00:00+00'
  from (values
    ($offer$https://jobs.ashbyhq.com/duck-duck-go/776bd1c8-81aa-4719-8238-ba357e1f5271$offer$, $offer$DuckDuckGo | Senior Product Designer | Romania · Remote · to apply · LinkedIn https://www.linkedin.com/jobs/view/4481960699 | source: LinkedIn | remote_verdict: Remote — to apply$offer$),
    ($offer$https://jobs.ashbyhq.com/Snyk/18909497-81c2-4a75-9b81-0c98d8cf7226/application$offer$, $offer$Snyk | Staff Product Designer | Lisbon, Portugal · Remote · to apply · LinkedIn https://www.linkedin.com/jobs/view/4474327088 | source: LinkedIn | remote_verdict: Remote — to apply$offer$),
    ($offer$https://tabby.pinpointhq.com/en/postings/71c10dc9-c190-491a-8079-a23c3478e652$offer$, $offer$Tabby | Senior Product Designer, BNPL Merchant Experience | Lisbon, Portugal · Remote · to apply · LinkedIn https://www.linkedin.com/jobs/view/4483595568 | source: LinkedIn | remote_verdict: Remote — to apply$offer$),
    ($offer$https://www.linkedin.com/jobs/view/4484023848$offer$, $offer$HERO Software | Senior Product Designer (w/m/d) | Berlin, Germany · Hybrid · Easy Apply, needs German | source: LinkedIn | remote_verdict: Hybrid — Easy Apply, needs German$offer$),
    ($offer$https://www.linkedin.com/jobs/view/4444585662$offer$, $offer$Aircall | Senior Product Designer | Madrid, Spain · Hybrid (3 days office) · Easy Apply | source: LinkedIn | remote_verdict: Hybrid — Easy Apply$offer$),
    ($offer$https://job-boards.eu.greenhouse.io/jetbrains/jobs/4806218101$offer$, $offer$JetBrains | Senior Product Designer (AIR) | Berlin, Germany · Hybrid · to apply · LinkedIn https://www.linkedin.com/jobs/view/4389692982 | source: LinkedIn | remote_verdict: Hybrid — to apply$offer$),
    ($offer$https://careers.teamviewer.com/jobs/8453344-senior-product-designer-dex$offer$, $offer$TeamViewer | Senior Product Designer DEX | Porto, Portugal · Hybrid · to apply · LinkedIn https://www.linkedin.com/jobs/view/4471888294 | source: LinkedIn | remote_verdict: Hybrid — to apply$offer$),
    ($offer$https://www.linkedin.com/jobs/view/4484484132$offer$, $offer$Sia | Product Designer – UX/UI | Paris, France · On-site · Easy Apply | source: LinkedIn | remote_verdict: On-site — Easy Apply$offer$),
    ($offer$https://www.linkedin.com/jobs/view/4484490001$offer$, $offer$Designshot | Senior Product Designer – Paris | Paris, France · Hybrid · Easy Apply | source: LinkedIn | remote_verdict: Hybrid — Easy Apply$offer$)
  ) as v(url, note)
  on conflict (url, user_id) do update
    set note = excluded.note
    where pipeline.processed is not true
      and pipeline.note is distinct from excluded.note;
end
$import$;
