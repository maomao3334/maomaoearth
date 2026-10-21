p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
old='''        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.EnvironmentVariables["MAOMAO_MBTILES_TOKEN"] = token;'''
new='''        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.EnvironmentVariables["MAOMAO_MBTILES_TOKEN"] = token;'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('redirect child stdout')
