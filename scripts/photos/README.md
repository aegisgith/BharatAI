# Speaker photos: matching faces in the event photos

Built 23 Nov 2026 for Mumbai 2026. The photographers' photos are in Google Drive:
"Nov 2026_Bharat AI_Mumbai" (folder `19Ii5MnQLA2adUxH4LDPikF2GUcvRuOeJ`, owned by anita.r@).
It is split by day, then by camera ("Cam 1 - Homi", "Cam 4", ...). That is 4,615 files:
4,493 JPG, 114 Canon RAW (.CR3, no JPG twin) and 8 videos.

These scripts find which speakers are in which photos. Their output is
`src/data/speaker-photos.json`, which the worker bundles (`src/routes/photos.ts`).
Everything runs on this computer. No face data leaves it, and none is committed: only
the Drive ids of the photos each person is in.

## Models

- Faces found by **YuNet** (`face_detection_yunet_2023mar.onnx`, OpenCV zoo, MIT).
- Faces compared by **AuraFace** (`glintr100.onnx` from `fal/AuraFace-v1` on Hugging Face,
  ArcFace ResNet-100, Apache-2.0). We do not use InsightFace's own models, because their
  licence is non-commercial.
- **SFace** (OpenCV zoo) is used only in pass 1 to straighten each face to the 112 x 112
  ArcFace layout. It cannot tell faces apart well enough on its own: different people
  score 0.40 to 0.48.
- Aarakshak (our face API) compares one face with one face and returns no embeddings, and
  gallery search is not provisioned for us. So it cannot search 4,600 photos. It could
  double-check borderline matches if we want that.

On this computer, onnxruntime only works as **1.19.2 with numpy < 2** (newer builds crash,
and the system one fails to load its DLL). Make two venvs:

```
python -m venv venv      && venv/Scripts/pip install opencv-python-headless==4.10.0.84 numpy pillow
python -m venv venv-ort  && venv-ort/Scripts/pip install onnxruntime==1.19.2 "numpy<2" opencv-python-headless==4.10.0.84
```

## Steps (WORK = a scratch folder with a few GB free)

1. **List the Drive folder** as JSON (`id, title, parentId, modifiedTime, fileSize,
   mimeType`) into `WORK/index.json`. In this session it came from the Drive connector,
   five pages of 1,000. For the JPGs, `modifiedTime` is the time the photo was taken. For
   the RAW files it is the upload time.
2. `python dl.py WORK/index.json WORK/img`: downloads each photo from Drive's image server
   at 2,000 px wide (`lh3.googleusercontent.com/d/<id>=w2000`; RAW files come back as
   JPEG). About 1.8 GB, 15 minutes.
3. `venv/python refs.py REPO models WORK/refs`: one reference face per speaker and per
   Innovation Talk speaker, from their photo on the site
   (`scripts/data/programme.json` speakers + talks).
4. `venv/python faces.py models WORK/img WORK/faces`: pass 1. Finds every face (at least
   24 px at 1,600 px wide), straightens it and saves the crop. About 50 minutes on 2
   workers (this computer has 7.9 GB of RAM; more workers ran out of memory).
5. `venv-ort/python embed.py models WORK/faces WORK/refs 40`: pass 2. AuraFace on faces at
   least 40 px wide (about 70% of them) and on the speaker refs. About 0.3 s a face on this
   CPU. Both passes can be stopped and run again; they carry on where they stopped.
6. `venv/python match.py WORK/faces WORK/refs WORK/img REPO WORK/out 0.50 0.08 0.30 --expand --sheets`.
   - A face counts as a person when it scores at least **0.50**, beats the runner-up by
     **0.08**, and scores at least **0.30 against their own site photo**. Different
     speakers' site photos score 0.11 on average (99% of pairs under 0.34). Wrong matches
     sat between 0.45 and 0.50 in the checks (another woman for a woman speaker, a
     lookalike on the same stage), so 0.45 was too low.
   - `--expand` adds each person's three surest event faces (0.55 or more, and 0.40 or
     more against the site photo) as extra references, which catches their side-on shots.
     The site-photo floor stops those extra references from pulling in lookalikes.
   - Look at every `qa_*.jpg` before exporting. Each row shows the site photo, then the
     matched faces with their scores, weakest last.
6b. `venv/python burst.py WORK/faces WORK/refs WORK/index.json WORK/out/matches.json WORK/burst 0.60 0.10 90 0.25 --drop REPO/scripts/photos/wrong-matches.json`
   (23 Nov, the organiser: "relax the rule so everyone gets the most photos"). Adds the
   shots where someone looks away, without a lower threshold: lowering it to 0.47 gave
   Surbhi Gupta, Sudhir Kumar Rai and Anita Ram strangers' faces.
   - A face joins person X only when the **same camera took a photo of X within 90
     seconds** that X is surely matched in, this face looks like X's face in that photo by
     **0.60** (same light, clothes and angle, so far easier than the site photo), beats
     every other person's nearby faces by 0.10, scores 0.25 against X's site photo, and
     looks no more like anyone else's site photo (0.45+). Two faces in one photo both
     pointing at X: neither is added. It added 212 photos for 56 people.
   - `wrong-matches.json` lists matches found wrong by eye; they are removed first, so no
     burst shot is added from them. Then export `WORK/burst/matches.json` in step 7.
   - **A speaker never takes a face an attendee's pass photo claims.** Run the attendee
     step first, then pass its albums to both scripts:
     `--not-faces WORK/att/albums.json REPO/scripts/photos/att-skip.json` (match.py and
     burst.py). On 23 Nov organiser Tushar Waghmode's album held 11 stage photos of an
     Innovation Talk speaker with a similar beard, and Dipti Agrawal's held 5 of a
     delegate: each face matched the attendee's own pass photo far better (0.77 against
     0.57). `att-skip.json` lists attendees who ARE a speaker (Bhupesh Daheria, Vishal
     Rally): their pass photo is their own, so their faces stay with the speaker album
     and they get no second album.
   - **Before calling a match wrong, check the programme, not only the face.** On 23 Nov
     Falguni Vasu's photos were taken out because the woman looked older than her site
     photo and wore thick glasses. They were her: she moderated the Insurance panel, and
     the photos are from that hall at that hour, with a microphone. Site photos can be ten
     years old. Wrong means the place or the day cannot be theirs (Surbhi Gupta's one: a
     woman at an exhibitor's booth on the day she was not there).
7. `venv/python export.py WORK/out/matches.json WORK/index.json WORK/img REPO/src/data/speaker-photos.json`,
   then `npm run build` and `node scripts/verify/smoke-speaker-photos.mjs`.
   - Up to six photos per person go in the email: landscape only (two whole photos a row),
     in-person shots first (0.80+ against the site photo is usually the stage screen showing
     that photo), bigger faces first, no two from one camera within 30 seconds, an even
     number.
   - `focus` records where their face is in each photo, so the page's square thumbnails
     keep them in view.

## Better reference photos, and guests not on the programme

- `ref-photos/<kind>-<id>.jpg` replaces a person's site photo as their reference
  (`speaker-3.jpg`: Dr. Abhijit Gangopadhyay's site photo also shows his face on the stage
  screen behind him, so the biggest face was the screen's).
- `guests.json` lists people the organiser names who are not speakers (id, name, title,
  role, email). Each needs `ref-photos/guest-<id>.jpg`. Their album key is `g<id>`, and
  they get the speakers' 50 full-size saves. A guest's reference can be their clearest event
  photo: find them in `cluster.py`'s sheets of faces nobody matched (biggest groups first),
  check against a portrait by eye, and save that crop. For a guest the 0.80 "stage screen"
  rule is off, because their reference is itself an event photo.

## Attendees (and re-running after people add a photo)

1. Read the list (ids, pass, photo link, check-in days; no names or emails) into `WORK/att/list.json`:
   `npx wrangler d1 execute bharatai-production --remote --json --command "SELECT a.id, a.badge_type AS pass, a.avatar_url AS photo, (SELECT group_concat(k.day) FROM checkins k WHERE k.attendee_id = a.id) AS days FROM attendees a WHERE a.event_id = 1 AND trim(COALESCE(a.avatar_url,'')) <> '' ORDER BY a.id" > WORK/att/list.json`
   then download each photo to `WORK/att/avatars/<id>.img` (dl step in the session notes).
2. `venv-ort/python att_match.py models WORK/faces WORK/refs WORK/img WORK/att WORK/att/albums.json 0.58 0.10 0.65 REPO/scripts/photos/att-skip.json --burst WORK/burst/matches.json`. Attendee face data stays in memory.
   `--burst` adds burst shots the same way as step 6b (0.62 to their face in a photo
   taken within 90 seconds, 0.45 against their pass photo), and never takes a speaker's face.
3. `venv/python att_qa.py ...` and look at the sheets, then `venv/python att_export.py WORK/att/albums.json WORK/index.json WORK/img REPO/src/data/attendee-photos.json`, build, `smoke-speaker-photos.mjs`, push.
4. People newly found show as ready in Admin, After the Event, Attendee photos. Anyone who said "Don’t match my photos" (admin_audit photos.opt_out) is never emailed; leave them out of the next run too.

The "Are you in the photos?" email (src/routes/find-photos.ts) asks everyone not found to add a clear photo; re-run steps 1-3 a day after it goes.

## Exhibitors' booth photos (by the company name printed in the photo)

The organiser, 23 Nov: every exhibitor gets the photos its name or logo is in, even when
no face was matched. No faces are used here, only printed text.

1. `venv-ort/python ocr.py WORK/img WORK/exh/ocr.json 2 WORK/exh/order.json`: RapidOCR
   (`pip install rapidocr-onnxruntime==1.3.24`) reads the text in every photo at 1,280 px.
   Slow (3 to 7 seconds a photo on this computer) and it can be stopped and run again. Run
   it ALONE: with a build or the face passes beside it this computer (8 GB) runs out of
   memory. `order.json` is an optional list of photo ids to read first (the booth cameras).
2. `venv/python exh_match.py WORK/exh/ocr.json exhibitor-names.json WORK/exh/folder.json WORK/img WORK/exh/booth.json --report`
   - `exhibitor-names.json`: one row a company: every `exhibitors` id of it (a company
     can have several rows), and the words that mean it. Add a row when an exhibitor is
     added; `"exact"` for short names (CGI, Seem, Aria, FTA) that must stand as a word.
   - A name counts at **6% of the photo's long side** (a booth fascia, standee or screen).
     A stage shot needs **20%** (their own talk slide): the stage's side walls and the
     screen's partner strip carry every exhibitor's logo. A photo is a stage shot when 3 or
     more companies are read in it, or it shows the stage's own words (IDFC FIRST Bank,
     Graham Bell, World Trade Center, "specialised tracks").
   - `"backdrop"` companies (IDFC FIRST Bank, Aegis, Gupshup) are printed on the backdrops,
     so only the "Cam 3 - Exhibition Booth" folder counts for them (`folder.json`: photo id
     to camera folder).
   - Look at the contact sheets (one row a company) before exporting.
3. `venv/python exh_export.py WORK/exh/booth.json exhibitor-names.json WORK/index.json WORK/img REPO/src/data/exhibitor-photos.json`,
   then `npm run build` and `node scripts/verify/smoke-booth-photos.mjs`.
4. They see them on the exhibitor dashboard, **Booth photos** (src/routes/exhibitor-photos.ts,
   public/static/booth-photos.js), and the organiser sends one email per company from
   Admin, After the Event, Booth photos. A photo shows only once it is in the photo store.

## Rules

- The Drive folder must stay **"Anyone with the link: Viewer"**. The pages and emails
  show the photos straight from Drive. If a file is moved or deleted, its picture breaks.
  Never "Editor": anyone with the link could then change or add files.
- Photos uploaded after a run are in nobody's album until the steps are run again.
- Never show a hall by its venue name ("Centrum"). Use the event's hall names.
