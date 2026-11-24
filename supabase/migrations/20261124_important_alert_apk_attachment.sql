-- Isolated FreePT TEST: optional immutable, verified release metadata for important alerts.
-- No file binaries, arbitrary download URLs or modifications to chat/Bridge tables.
alter table public.important_alerts
 add column if not exists apk_attachment jsonb;
alter table public.important_alerts
 add constraint important_alert_apk_attachment_shape check (
   apk_attachment is null or (
     jsonb_typeof(apk_attachment)='object'
     and apk_attachment ?& array['url','sha256','versionName','versionCode']
     and jsonb_typeof(apk_attachment->'url')='string'
     and jsonb_typeof(apk_attachment->'sha256')='string'
     and jsonb_typeof(apk_attachment->'versionName')='string'
     and jsonb_typeof(apk_attachment->'versionCode')='number'
   )
 );
