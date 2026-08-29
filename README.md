# Cycle Beat

Field tool for AEs, plus a branch view. Give it a starting point, it finds
Cycle-serviced outlets that ITC does not reach nearby, orders them into a
sensible drive, and lets the AE log remarks and photos before sending a PDF.
With Supabase configured, everything the AE logs also lands in the branch view.

```
index.html             the field app
dashboard.html         branch view (admins see every AE)
admin.html             upload the outlet list from Excel or CSV
config.js              <- the only file you have to edit
sync.js                offline-first Supabase sync
outlet-source.js       reads outlets from Supabase, falls back to data/
supabase/schema.sql    beats, visits, RLS, photo bucket
supabase/outlets.sql   outlet master + proximity search
data/                  125,505 outlets in 251 tiles (the offline fallback)
vendor/                Leaflet, jsPDF, SheetJS, supabase-js
build_tiles.py         regenerates data/ from a new Excel export
```

## 1. Supabase

1. Create a project at supabase.com (free tier is plenty).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
   Then a second query with `supabase/outlets.sql` → Run.
3. Authentication → Providers → Email → turn **off** "Confirm email".
   You create the AE accounts, they do not self-register.
4. Authentication → Users → Add user, one per AE. Give each a password.
5. Make yourself admin — SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@itc.in');
   ```
6. `config.js` is already filled in for project `mnjtzdfkvgliftqufncd`.
   Nothing to do unless you switch projects.

The anon key is designed to be public and is safe in a repo — but only once
RLS is on. Until step 2 has run, that key can read and write your project
freely, so run the schema before you push the repo anywhere public. After
that, an AE can only touch their own beats and an admin can read everything.
Never put the `service_role` key in `config.js`.

## 2. GitHub Pages

1. Push this folder to a repo, keeping the structure intact.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/`.
3. Wait for the green tick, then open the Pages URL on a phone and add it to
   the home screen.

Field app: `https://<you>.github.io/<repo>/`
Branch view: `https://<you>.github.io/<repo>/dashboard.html`

It must be served over `https://`. Opening `index.html` off the file system
will not work — the data files are blocked and GPS needs a secure origin.

## 3. Check it end to end

Sign in as an AE → build a route → mark a stop Visited → add a photo. The pill
top-right should go **Syncing… → Synced**. Open the dashboard as admin and the
beat should be there with the photo.

## How syncing behaves

The phone is the source of truth. Everything is written to the phone first, so
the app keeps working with no signal — the pill shows *Offline — queued* and it
pushes when the network returns. A failed sync retries rather than losing work.

- **Sign-in is optional.** "Work offline on this phone" skips it entirely and
  the app behaves exactly as it did before Supabase existed.
- **Leave `config.js` blank** and the whole app runs local-only, no accounts.
- **Switching phones:** sign in and the app offers to pull your open beat down,
  photos included.
- **Generating the PDF** offers to file the beat, which marks it closed and
  moves it out of the "Open" filter on the dashboard.

## Loading and refreshing the outlet list

Open `admin.html` as an admin, drop in the Excel or CSV, match the columns
and upload. It handles roughly 125,000 rows in about a minute. "Replace
everything" swaps the whole list, "Add and update" merges a partial one.
Nothing is committed until every row has been staged, so a failed upload
leaves the live list untouched.

Where outlets come from, in order:

1. **Supabase**, once you have uploaded a list. Postgres does the distance
   maths and returns only the nearest few hundred — far less to download
   than a map tile in a dense market, and it means updating outlets never
   needs a redeploy.
2. **The bundled tiles in `data/`**, automatically, whenever Supabase is
   unreachable, empty, or the AE is working signed out. This is why the app
   keeps working with no signal.

The tiles are a snapshot of the file you first gave me. To refresh that
offline copy too, run `build_tiles.py` against a new export and replace
`data/`. If you only ever work online, uploading through `admin.html` is
enough on its own.

## Worth knowing

- **Road routing** uses the public OSRM demo server. If it is unreachable the
  app still sequences the stops and shows an estimated distance, labelled as
  an estimate. For branch-wide daily use, run your own OSRM.
- **Search** uses OpenStreetMap Nominatim — fine for a field team, not for bulk.
- **Photos** are compressed to roughly 100–150 KB before upload. Supabase's free
  tier gives 1 GB of storage, so budget about 7,000 photos before you need a
  paid plan.
- Outlet IDs repeat across states in the source data, so outlets are keyed
  `State-ID` throughout.
