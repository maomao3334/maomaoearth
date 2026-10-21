p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
old='''            if (a == "--port" && i + 1 < args.Length) { int.TryParse(args[++i], out port); continue; }
            if (a == "--no-browser") { noBrowser = true; continue; }'''
new='''            if (a == "--help" || a == "-h") { PrintHelp(); return 0; }
            if (a == "--port" && i + 1 < args.Length) { int.TryParse(args[++i], out port); continue; }
            if (a == "--no-browser") { noBrowser = true; continue; }'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('help fixed')
