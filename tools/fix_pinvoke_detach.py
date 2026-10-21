p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('using System.Management;\n','',1)
# insert structs and helper before OpenMbtiles method
anchor='''    static int OpenMbtiles(string file, int port, bool noBrowser)'''
helper=r'''    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles,
        uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    static int StartDetachedProcess(string arguments)
    {
        IntPtr nul = CreateFile("NUL", 0xC0000000, 0x00000003, IntPtr.Zero, 3, 0, IntPtr.Zero);
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = 0x00000100;
        si.hStdInput = nul;
        si.hStdOutput = nul;
        si.hStdError = nul;
        PROCESS_INFORMATION pi;
        StringBuilder cmd = new StringBuilder("\"" + Process.GetCurrentProcess().MainModule.FileName + "\" " + arguments);
        bool ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
            IntPtr.Zero, IntPtr.Zero, true, 0x00000008 | 0x08000000, IntPtr.Zero, appDir, ref si, out pi);
        if (nul != IntPtr.Zero) CloseHandle(nul);
        if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        int pid = pi.dwProcessId;
        if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
        if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
        return pid;
    }

'''
c=c.replace(anchor, helper+anchor,1)
# replace WMI block
start=c.find('        uint childPid = 0;')
end=c.find('        int tilePort = 0;', start)
assert start>0 and end>start
newblock='''        uint childPid = 0;
        try
        {
            childPid = (uint)StartDetachedProcess("__mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("无法创建后台 MBTiles 进程：" + ex.Message);
            try { File.Delete(tokenFile); } catch { }
            return 1;
        }
'''
c=c[:start]+newblock+c[end:]
open(p,'w',encoding='utf-8',newline='').write(c)
print('PInvoke detach patched')
