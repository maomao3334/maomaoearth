p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('const string Version = "0.3.0";','const string Version = "0.4.0";',1)
old='        Console.WriteLine("数据目录：data/ " + (Directory.Exists(Path.Combine(appDir, "data")) ? "OK" : "缺失"));'
new=old+'\n        Console.WriteLine("winsqlite3.dll：" + (File.Exists(Path.Combine(Environment.SystemDirectory, "winsqlite3.dll")) ? "OK" : "缺失"));'
if old in c: c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read().replace("version: '0.3.0'","version: '0.4.0'")
open(p2,'w',encoding='utf-8',newline='').write(a)
print('version bumped')
