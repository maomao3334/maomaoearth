import os, collections
root=r'G:\sh\local-earth\data\public\tiles\blue-marble'
for z in sorted(os.listdir(root), key=lambda x:int(x) if x.isdigit() else 999):
 p=os.path.join(root,z)
 if not os.path.isdir(p): continue
 xs=[]; ys=[]; n=0
 for x in os.listdir(p):
  xp=os.path.join(p,x)
  if not os.path.isdir(xp): continue
  for y in os.listdir(xp):
   if y.lower().endswith('.jpg'):
    n+=1; xs.append(int(x)); ys.append(int(y[:-4]))
 print(z,'n',n,'x',min(xs) if xs else None,max(xs) if xs else None,'y',min(ys) if ys else None,max(ys) if ys else None)
print('S2')
root=r'G:\sh\local-earth\data\public\imagery\s2cloudless'
for z in sorted(os.listdir(root), key=lambda x:int(x) if x.isdigit() else 999):
 p=os.path.join(root,z)
 if not os.path.isdir(p): continue
 xs=[]; ys=[]; n=0
 for x in os.listdir(p):
  xp=os.path.join(p,x)
  if not os.path.isdir(xp): continue
  for y in os.listdir(xp):
   if y.lower().endswith('.jpg'):
    n+=1; xs.append(int(x)); ys.append(int(y[:-4]))
 print(z,'n',n,'x',min(xs) if xs else None,max(xs) if xs else None,'y',min(ys) if ys else None,max(ys) if ys else None)
