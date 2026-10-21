p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('''        int pid;
        if (st.TryGetValue("pid", out string pidText) && int.TryParse(pidText, out pid))''','''        int pid;
        string pidText;
        if (st.TryGetValue("pid", out pidText) && int.TryParse(pidText, out pid))''',1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('fixed')
