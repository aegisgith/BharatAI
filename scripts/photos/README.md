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
   Falguni Vasu, Surbhi Gupta, Sudhir Kumar Rai and Anita Ram strangers' faces.
   - A face joins person X only when the **same camera took a photo of X within 90
     seconds** that X is surely matched in, this face looks like X's face in that photo by
     **0.60** (same light, clothes and angle, so far easier than the site photo), beats
     every other person's nearby faces by 0.10, scores 0.25 against X's site photo, and
     looks no more like anyone else's site photo (0.45+). Two faces in one photo both
     pointing at X: neither is added. It added 212 photos for 56 people.
   - `wrong-matches.json` lists matches found wrong by eye; they are removed first, so no
     burst shot is added from them. Then export `WORK/burst/matches.json` in step 7.
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

## Rules

- The Drive folder must stay **"Anyone with the link: Viewer"**. The pages and emails
  show the photos straight from Drive. If a file is moved or deleted, its picture breaks.
  Never "Editor": anyone with the link could then change or add files.
- Photos uploaded after a run are in nobody's album until the steps are run again.
- Never show a hall by its venue name ("Centrum"). Use the event's hall names.
