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
7. `venv/python export.py WORK/out/matches.json WORK/index.json WORK/img REPO/src/data/speaker-photos.json`,
   then `npm run build` and `node scripts/verify/smoke-speaker-photos.mjs`.
   - Up to six photos per person go in the email: landscape only (two whole photos a row),
     in-person shots first (0.80+ against the site photo is usually the stage screen showing
     that photo), bigger faces first, no two from one camera within 30 seconds, an even
     number.
   - `focus` records where their face is in each photo, so the page's square thumbnails
     keep them in view.

## Rules

- The Drive folder must stay **"Anyone with the link: Viewer"**. The pages and emails
  show the photos straight from Drive. If a file is moved or deleted, its picture breaks.
  Never "Editor": anyone with the link could then change or add files.
- Photos uploaded after a run are in nobody's album until the steps are run again.
- Never show a hall by its venue name ("Centrum"). Use the event's hall names.
