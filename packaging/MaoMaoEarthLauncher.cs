using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

// MaomaoEarth 免安装启动器（.NET Framework / csc 编译，无需 Electron/Node）
// 命令：
//   MaoMaoEarth.exe                 启动本地服务并打开应用窗口
//   MaoMaoEarth.exe open            同上
//   MaoMaoEarth.exe serve [--port N] [--no-browser]   前台运行本地服务（CLI）
//   MaoMaoEarth.exe --cli serve ... 同上
//   MaoMaoEarth.exe check           打印环境/服务状态
//   MaoMaoEarth.exe stop            停止由本启动器启动的服务
//   MaoMaoEarth.exe windninja <dir> 启动服务并打开指定 WindNinja 结果目录
class MaoMaoEarthLauncher
{
    const string Version = "0.3.0";
    static string appDir;
    static string pidPath;
    static string logPath;

    static int Main(string[] args)
    {
        appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        pidPath = Path.Combine(appDir, ".maomaoearth.pid");
        logPath = Path.Combine(appDir, "maomaoearth.log");

        string command = "";
        int port = 8123;
        bool noBrowser = false;
        string windDir = null;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i] ?? "";
            if (a == "--port" && i + 1 < args.Length) { int.TryParse(args[++i], out port); continue; }
            if (a == "--no-browser") { noBrowser = true; continue; }
            if (a == "--cli") { if (command == "") command = "serve"; continue; }
            if (a.StartsWith("-")) continue;
            if (command == "") command = a;
            else if (windDir == null) windDir = a;
        }
        if (command == "") command = "open";
        if (command == "help" || command == "--help" || command == "-h") { PrintHelp(); return 0; }

        try
        {
            switch (command)
            {
                case "check":
                    return Check();
                case "stop":
                    return StopServer();
                case "serve":
                    return Serve(port, noBrowser, true);
                case "windninja":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("windninja 需要目录参数"); return 2; }
                    return OpenWindDir(windDir, port, noBrowser);
                case "open":
                    return Serve(port, noBrowser, false);
                default:
                    Console.Error.WriteLine("未知命令：" + command);
                    PrintHelp();
                    return 2;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("启动失败：" + ex.Message);
            return 1;
        }
    }

    static void PrintHelp()
    {
        Console.WriteLine("MaomaoEarth " + Version + " — 本地地球（完全离线）");
        Console.WriteLine("用法：");
        Console.WriteLine("  MaoMaoEarth.exe                       启动并打开应用");
        Console.WriteLine("  MaoMaoEarth.exe open                  同上");
        Console.WriteLine("  MaoMaoEarth.exe serve [--port 8123] [--no-browser]");
        Console.WriteLine("                                        前台运行本地服务（CLI）");
        Console.WriteLine("  MaoMaoEarth.exe check                 打印环境与服务状态");
        Console.WriteLine("  MaoMaoEarth.exe stop                  停止本启动器启动的服务");
        Console.WriteLine("  MaoMaoEarth.exe windninja <目录>      启动并打开 WindNinja 结果目录");
        Console.WriteLine("  MaoMaoEarth.exe --help");
        Console.WriteLine();
        Console.WriteLine("说明：服务仅监听 127.0.0.1，浏览器以 --app 窗口模式打开；数据全部本地读取。");
    }

    static string EdgePath()
    {
        string[] paths = new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe")
        };
        foreach (string p in paths) if (File.Exists(p)) return p;
        return null;
    }

    static bool ServerReady(int port)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/");
            req.Method = "GET";
            req.Timeout = 1500;
            req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
            {
                return (int)res.StatusCode == 200;
            }
        }
        catch { return false; }
    }

    static int FreePort(int start)
    {
        for (int p = start; p < start + 60; p++)
        {
            TcpListener l = null;
            try
            {
                l = new TcpListener(IPAddress.Loopback, p);
                l.Start();
                l.Stop();
                return p;
            }
            catch { if (l != null) { try { l.Stop(); } catch { } } }
        }
        return -1;
    }

    static Process StartServer(int port)
    {
        string ps = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell\\v1.0\\powershell.exe");
        if (!File.Exists(ps)) ps = "powershell.exe";
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = ps;
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(appDir, "serve.ps1") + "\" -Port " + port + " -NoBrowser";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        Process p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { AppendLog(e.Data); };
        p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { AppendLog(e.Data); };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        File.WriteAllText(pidPath, p.Id.ToString());
        return p;
    }

    static void AppendLog(string line)
    {
        if (line == null) return;
        try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    static int EnsureServer(ref int port)
    {
        if (!File.Exists(Path.Combine(appDir, "index.html")) || !File.Exists(Path.Combine(appDir, "serve.ps1")))
        {
            Console.Error.WriteLine("应用目录不完整：需要 index.html 与 serve.ps1 位于 " + appDir);
            return 1;
        }
        if (ServerReady(port))
        {
            Console.WriteLine("已有本地服务在 http://127.0.0.1:" + port + "/");
            return 0;
        }
        if (FreePort(port) != port)
        {
            int np = FreePort(port);
            if (np < 0) { Console.Error.WriteLine("找不到可用端口"); return 1; }
            port = np;
        }
        Process p = StartServer(port);
        for (int i = 0; i < 120; i++)
        {
            Thread.Sleep(100);
            if (ServerReady(port)) return 0;
            if (p.HasExited) break;
        }
        Console.Error.WriteLine("本地服务启动失败，详见 " + logPath);
        return 1;
    }

    static void OpenBrowser(int port)
    {
        string url = "http://127.0.0.1:" + port + "/";
        string edge = EdgePath();
        try
        {
            if (edge != null)
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = edge;
                psi.Arguments = "--app=" + url + " --window-size=1600,950";
                psi.UseShellExecute = false;
                Process.Start(psi);
                Console.WriteLine("已打开应用窗口：" + url);
            }
            else
            {
                Process.Start(url);
                Console.WriteLine("已用默认浏览器打开：" + url);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("无法自动打开浏览器（" + ex.Message + "），请手动访问 " + url);
        }
    }

    static int Serve(int port, bool noBrowser, bool foreground)
    {
        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        string url = "http://127.0.0.1:" + port + "/";
        if (foreground)
        {
            Console.WriteLine("MaomaoEarth 服务运行中：" + url);
            Console.WriteLine("按 Ctrl+C 或关闭此窗口停止服务。");
            Console.Out.Flush();
            // 前台保持：等待服务进程退出（或用户 Ctrl+C 终止本进程）
            try
            {
                string pidText = File.Exists(pidPath) ? File.ReadAllText(pidPath).Trim() : "";
                int pid;
                if (int.TryParse(pidText, out pid))
                {
                    Process p = Process.GetProcessById(pid);
                    p.WaitForExit();
                }
                else
                {
                    while (true) Thread.Sleep(1000);
                }
            }
            catch { while (true) Thread.Sleep(1000); }
            return 0;
        }
        if (!noBrowser) OpenBrowser(port);
        else Console.WriteLine("服务地址：" + url);
        return 0;
    }

    static int Check()
    {
        Console.WriteLine("MaomaoEarth " + Version);
        Console.WriteLine("应用目录：" + appDir);
        Console.WriteLine("index.html：" + (File.Exists(Path.Combine(appDir, "index.html")) ? "OK" : "缺失"));
        Console.WriteLine("serve.ps1：" + (File.Exists(Path.Combine(appDir, "serve.ps1")) ? "OK" : "缺失"));
        Console.WriteLine("Edge/Chrome：" + (EdgePath() ?? "未找到（将用默认浏览器）"));
        Console.WriteLine("数据目录：data/ " + (Directory.Exists(Path.Combine(appDir, "data")) ? "OK" : "缺失"));
        Console.WriteLine("8123 服务：" + (ServerReady(8123) ? "运行中" : "未运行"));
        try
        {
            if (File.Exists(pidPath))
            {
                string pid = File.ReadAllText(pidPath).Trim();
                Console.WriteLine("记录的服务 PID：" + pid);
            }
        }
        catch { }
        Console.WriteLine("日志：" + logPath);
        return 0;
    }

    static int StopServer()
    {
        if (!File.Exists(pidPath)) { Console.WriteLine("没有记录的服务 PID（可能未由本启动器启动）"); return 0; }
        int pid;
        if (!int.TryParse(File.ReadAllText(pidPath).Trim(), out pid)) { Console.WriteLine("PID 文件无效"); return 1; }
        try
        {
            Process p = Process.GetProcessById(pid);
            p.Kill();
            p.WaitForExit(3000);
            File.Delete(pidPath);
            Console.WriteLine("已停止服务 PID " + pid);
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("停止失败：" + ex.Message);
            try { File.Delete(pidPath); } catch { }
            return 1;
        }
    }

    static int OpenWindDir(string dir, int port, bool noBrowser)
    {
        if (!Directory.Exists(dir)) { Console.Error.WriteLine("目录不存在：" + dir); return 1; }
        // 复制/收集 WindNinja 结果目录中的 vel/ang/prj 到应用内样例目录，便于直接用 URL 打开
        string name = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar));
        if (string.IsNullOrEmpty(name)) name = "windninja";
        string dest = Path.Combine(appDir, "data", "samples", "windninja", "cli-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + name);
        Directory.CreateDirectory(dest);
        string[] files = Directory.GetFiles(dir, "*", SearchOption.AllDirectories);
        string firstVel = null;
        foreach (string f in files)
        {
            string lower = f.ToLowerInvariant();
            if (!(lower.EndsWith(".asc") || lower.EndsWith(".prj") || lower.EndsWith(".cfg") || lower.EndsWith(".csv"))) continue;
            string target = Path.Combine(dest, Path.GetFileName(f));
            try { File.Copy(f, target, true); } catch { continue; }
            if (firstVel == null && lower.EndsWith("_vel.asc")) firstVel = target;
        }
        if (firstVel == null) { Console.Error.WriteLine("目录中未找到 *_vel.asc，请确认是 WindNinja 输出目录"); return 1; }
        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        string rel = firstVel.Substring(appDir.Length).TrimStart(Path.DirectorySeparatorChar).Replace('\\', '/');
        string url = "http://127.0.0.1:" + port + "/?windninja=" + Uri.EscapeDataString(rel);
        Console.WriteLine("已导入 WindNinja 结果：" + firstVel);
        if (!noBrowser) OpenBrowserUrl(url);
        else Console.WriteLine("打开：" + url);
        return 0;
    }

    static void OpenBrowserUrl(string url)
    {
        string edge = EdgePath();
        try
        {
            if (edge != null)
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = edge;
                psi.Arguments = "--app=" + url + " --window-size=1600,950";
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else Process.Start(url);
        }
        catch { }
    }
}
