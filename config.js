/* ---------------------------------------------------------------------
   Supabase project details.
   Dashboard → Project Settings → API.

   The anon key is designed to be public and is safe in a GitHub repo.
   What protects the data is Row Level Security, which supabase/schema.sql
   turns on. Until that SQL has been run this key can read and write freely,
   so run the schema before you push this anywhere public.

   Never put the service_role key in this file.

   Blank the url to run local-only: the app still works end to end,
   nothing syncs, and the PDF is the only way data leaves the phone.
--------------------------------------------------------------------- */
window.CONFIG = {
  url:     'https://mnjtzdfkvgliftqufncd.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uanR6ZGZrdmdsaWZ0cXVmbmNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjI3OTYsImV4cCI6MjEwMzU5ODc5Nn0._NeRS3lufq4tEIICs0ogEpxrshQvp1NeYqY9PuewTcc',
  branch:  'SHYD'
};
