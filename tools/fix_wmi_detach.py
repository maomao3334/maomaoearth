p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('using System.Net.Sockets;','using System.Net.Sockets;\nusing System.Management;',1)
old='''        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = Process.GetCurrentProcess().MainModule.FileName;
        psi.Arguments = "__mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        Process child = Process.Start(psi);
        int tilePort = 0;'''
new='''        uint childPid = 0;
        try
        {
            using (ManagementClass mc = new ManagementClass("Win32_Process"))
            {
                ManagementBaseObject inParams = mc.GetMethodParameters("Create");
                inParams["CommandLine"] = "\\"" + Process.GetCurrentProcess().MainModule.FileName + "\\" __mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"";
                inParams["CurrentDirectory"] = appDir;
                ManagementBaseObject outParams = mc.InvokeMethod("Create", inParams, null);
                uint ret = Convert.ToUInt32(outParams["ReturnValue"]);
                if (ret != 0) throw new Exception("Win32_Process.Create 返回 " + ret);
                childPid = Convert.ToUInt32(outParams["ProcessId"]);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("无法创建后台 MBTiles 进程：" + ex.Message);
            try { File.Delete(tokenFile); } catch { }
            return 1;
        }
        int tilePort = 0;'''
if old not in c: print('parent block miss')
else: c=c.replace(old,new,1)
c=c.replace('''            try { if (child != null && !child.HasExited) child.Kill(); } catch { }''','''            try { if (childPid > 0) Process.GetProcessById((int)childPid).Kill(); } catch { }''',1)
c=c.replace('''        Console.WriteLine("MBTiles 后台服务：" + "http://127.0.0.1:" + tilePort + "（PID " + child.Id + "）");''','''        Console.WriteLine("MBTiles 后台服务：" + "http://127.0.0.1:" + tilePort + "（PID " + childPid + "）");''',1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('WMI detach patched')
