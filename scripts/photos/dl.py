import json,sys,os,time,urllib.request,concurrent.futures as cf
idx=json.load(open(sys.argv[1])); out=sys.argv[2]
todo=[f for f in idx if f['mimeType'] in ('image/jpeg','image/cr3') and not os.path.exists(os.path.join(out,f['id']+'.jpg'))]
print('todo',len(todo),flush=True)
def get(f):
    p=os.path.join(out,f['id']+'.jpg')
    for a in range(6):
        try:
            b=urllib.request.urlopen(urllib.request.Request(f"https://lh3.googleusercontent.com/d/{f['id']}=w2000",headers={'User-Agent':'Mozilla/5.0'}),timeout=60).read()
            if len(b)<2000: raise Exception('tiny')
            open(p+'.part','wb').write(b); os.replace(p+'.part',p); return 1
        except Exception as e:
            time.sleep(2*(a+1)**2)
    return 0
ok=0
with cf.ThreadPoolExecutor(8) as ex:
    for i,r in enumerate(ex.map(get,todo)):
        ok+=r
        if i%250==0: print(i,ok,flush=True)
print('done',ok,'of',len(todo),flush=True)
