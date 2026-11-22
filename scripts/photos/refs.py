# Reference face per speaker from the site's own speaker photos.
import sys,os,json,numpy as np,cv2
from PIL import Image
REPO,M,OUT=sys.argv[1],sys.argv[2],sys.argv[3]
p=json.load(open(os.path.join(REPO,'scripts/data/programme.json'),encoding='utf-8'))
det=cv2.FaceDetectorYN.create(os.path.join(M,'yunet.onnx'),'',(320,320),0.6,0.3,50)
rec=cv2.FaceRecognizerSF.create(os.path.join(M,'sface.onnx'),'')
people=[]
for s in p['speakers']: people.append({'kind':'speaker','id':s['id'],'name':s['name'],'org':s.get('organisation',''),'photo':s.get('photo_url') or ''})
for t in p['talks']: people.append({'kind':'talk','id':t['id'],'name':t['speaker_name'],'org':t.get('company',''),'photo':t.get('photo_url') or ''})
feats=[];keep=[];fail=[]
for x in people:
    f=os.path.join(REPO,'public'+x['photo']) if x['photo'].startswith('/images') else ''
    if not f or not os.path.exists(f): fail.append((x['name'],'no photo')); continue
    im=cv2.cvtColor(np.array(Image.open(f).convert('RGB')),cv2.COLOR_RGB2BGR)
    h,w=im.shape[:2]
    if max(h,w)<400: im=cv2.resize(im,None,fx=400/max(h,w),fy=400/max(h,w)); h,w=im.shape[:2]
    det.setInputSize((w,h)); _,fs=det.detect(im)
    if fs is None or len(fs)==0: fail.append((x['name'],'no face in photo')); continue
    fb=max(fs,key=lambda r:r[2]*r[3])
    crop=rec.alignCrop(im,fb); os.makedirs(OUT+'_crops',exist_ok=True); x['crop']=os.path.join(OUT+'_crops',f'{len(keep)}.jpg'); cv2.imwrite(x['crop'],crop,[cv2.IMWRITE_JPEG_QUALITY,95])
    feats.append(rec.feature(crop).flatten()); x['nfaces']=len(fs); keep.append(x)
np.save(OUT+'.npy',np.array(feats,dtype=np.float32)); json.dump(keep,open(OUT+'.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
print('refs',len(keep),'failed',len(fail)); [print(' ',a,'-',b) for a,b in fail]
print('photos with >1 face:',[x['name'] for x in keep if x['nfaces']>1])
