p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
old='''        bool ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
            IntPtr.Zero, IntPtr.Zero, true, 0x00000008 | 0x08000000, IntPtr.Zero, appDir, ref si, out pi);'''
new='''        uint flags = 0x00000008 | 0x08000000 | 0x00000200 | 0x01000000;
        bool ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
            IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, appDir, ref si, out pi);
        if (!ok)
        {
            flags = 0x00000008 | 0x08000000 | 0x00000200;
            ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
                IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, appDir, ref si, out pi);
        }'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('breakaway flag added')
