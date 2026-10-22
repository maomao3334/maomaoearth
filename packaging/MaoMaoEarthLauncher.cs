using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Runtime.InteropServices;
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
//   MaoMaoEarth.exe mbtiles <file> 启动本地 MBTiles 瓦片服务并打开应用
class MaoMaoEarthLauncher
{
    const string Version = "0.6.0";
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
        string extraArg = null;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i] ?? "";
            if (a == "--help" || a == "-h") { PrintHelp(); return 0; }
            if (a == "--port" && i + 1 < args.Length) { int.TryParse(args[++i], out port); continue; }
            if (a == "--no-browser") { noBrowser = true; continue; }
            if (a == "--cli") { if (command == "") command = "serve"; continue; }
            if (a.StartsWith("-")) continue;
            if (command == "") command = a;
            else if (windDir == null) windDir = a;
            else if (extraArg == null) extraArg = a;
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
                case "mbtiles":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("mbtiles 需要 .mbtiles 文件参数"); return 2; }
                    return OpenMbtiles(windDir, port, noBrowser);
                case "__mbtiles-server":
                    return RunMbtilesChild(windDir, extraArg);
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
        Console.WriteLine("  MaoMaoEarth.exe mbtiles <文件>        后台启动 MBTiles 瓦片服务并打开应用");
        Console.WriteLine("    --port 8123 --no-browser             可选：静态服务端口 / 不自动打开浏览器");
        Console.WriteLine("  MaoMaoEarth.exe stop                  停止静态服务与后台 MBTiles 服务");
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
        Console.WriteLine("winsqlite3.dll：" + (File.Exists(Path.Combine(Environment.SystemDirectory, "winsqlite3.dll")) ? "OK" : "缺失"));
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
        StopMbtilesService(true);
        if (!File.Exists(pidPath)) { Console.WriteLine("没有记录的静态服务 PID（可能未由本启动器启动）"); return 0; }
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


    static string MbtilesStatePath
    {
        get { return Path.Combine(appDir, ".maomaoearth-mbtiles.state"); }
    }

    static Dictionary<string, string> ReadState(string path)
    {
        Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return d;
        try
        {
            foreach (string line in File.ReadAllLines(path))
            {
                int i = line.IndexOf('=');
                if (i > 0) d[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
            }
        }
        catch { }
        return d;
    }

    static bool MbtilesHealth(int port, string token)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health?token=" + Uri.EscapeDataString(token));
            req.Method = "GET"; req.Timeout = 1200; req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) return (int)res.StatusCode == 200;
        }
        catch { return false; }
    }

    static void StopMbtilesService(bool verbose)
    {
        string path = MbtilesStatePath;
        if (!File.Exists(path)) return;
        Dictionary<string, string> st = ReadState(path);
        int pid;
        string pidText;
        if (st.TryGetValue("pid", out pidText) && int.TryParse(pidText, out pid))
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                p.Kill(); p.WaitForExit(2000);
                if (verbose) Console.WriteLine("已停止后台 MBTiles 服务 PID " + pid);
            }
            catch { }
        }
        try { File.Delete(path); } catch { }
    }

    static int RunMbtilesChild(string file, string statePath)
    {
        if (string.IsNullOrEmpty(file) || string.IsNullOrEmpty(statePath))
        {
            Console.Error.WriteLine("__mbtiles-server 参数不完整");
            return 2;
        }
        string token = Environment.GetEnvironmentVariable("MAOMAO_MBTILES_TOKEN");
        string tokenFile = statePath + ".tok";
        if (File.Exists(tokenFile))
        {
            try { token = File.ReadAllText(tokenFile).Trim(); File.Delete(tokenFile); } catch { }
        }
        try
        {
            MbtilesServer server = new MbtilesServer(file, token);
            server.Start();
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("pid=" + Process.GetCurrentProcess().Id);
            sb.AppendLine("port=" + server.Port);
            sb.AppendLine("token=" + server.Token);
            sb.AppendLine("file=" + file);
            File.WriteAllText(statePath, sb.ToString(), new UTF8Encoding(false));
            while (true) Thread.Sleep(1000);
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(statePath, "error=" + ex.Message + Environment.NewLine, new UTF8Encoding(false)); } catch { }
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
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
        uint flags = 0x00000008 | 0x08000000 | 0x00000200 | 0x01000000;
        bool ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
            IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, appDir, ref si, out pi);
        if (!ok)
        {
            flags = 0x00000008 | 0x08000000 | 0x00000200;
            ok = CreateProcess(Process.GetCurrentProcess().MainModule.FileName, cmd,
                IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, appDir, ref si, out pi);
        }
        if (nul != IntPtr.Zero) CloseHandle(nul);
        if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        int pid = pi.dwProcessId;
        if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
        if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
        return pid;
    }

    static int OpenMbtiles(string file, int port, bool noBrowser)
    {
        if (!File.Exists(file)) { Console.Error.WriteLine("MBTiles 文件不存在：" + file); return 1; }
        string full = Path.GetFullPath(file);
        byte[] head = new byte[16];
        try
        {
            using (FileStream fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                if (fs.Read(head, 0, 16) != 16) { Console.Error.WriteLine("文件过小，不是 MBTiles"); return 1; }
            }
        }
        catch (Exception ex) { Console.Error.WriteLine("读取 MBTiles 失败：" + ex.Message); return 1; }
        if (!Encoding.ASCII.GetString(head).StartsWith("SQLite format 3"))
        {
            Console.Error.WriteLine("不是 SQLite/MBTiles 文件（缺少 SQLite 文件头）");
            return 1;
        }
        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        StopMbtilesService(false);
        string statePath = MbtilesStatePath;
        string token = Guid.NewGuid().ToString("N");
        try { File.WriteAllText(statePath + ".tok", token, new UTF8Encoding(false)); } catch { }
        try
        {
            StartDetachedProcess("__mbtiles-server \"" + full + "\" \"" + statePath + "\"");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("后台 MBTiles 服务启动失败：" + ex.Message);
            return 1;
        }
        Dictionary<string, string> st = null;
        string statePid = null, stateToken = null;
        int mport = 0;
        for (int i = 0; i < 150; i++)
        {
            Thread.Sleep(100);
            st = ReadState(statePath);
            if (st.ContainsKey("error")) { Console.Error.WriteLine("MBTiles 服务错误：" + st["error"]); return 1; }
            if (st.TryGetValue("port", out statePid) && int.TryParse(statePid, out mport)) { st.TryGetValue("token", out stateToken); break; }
        }
        if (mport <= 0 || string.IsNullOrEmpty(stateToken))
        {
            Console.Error.WriteLine("后台 MBTiles 服务未就绪，请查看 " + statePath);
            return 1;
        }
        string baseUrl = "http://127.0.0.1:" + mport;
        string appUrl = "http://127.0.0.1:" + port + "/?mbtiles=" + Uri.EscapeDataString(baseUrl) + "&mbtoken=" + Uri.EscapeDataString(stateToken);
        Console.WriteLine("MBTiles 已在后台挂载：" + full);
        Console.WriteLine("MBTILES_SERVER=" + baseUrl);
        Console.WriteLine("MBTILES_TOKEN=" + stateToken);
        Console.WriteLine("MBTILES_META=" + baseUrl + "/meta.json?token=" + stateToken);
        Console.WriteLine("MBTILES_APP=" + appUrl);
        Console.WriteLine("MBTILES_PID=" + (st.ContainsKey("pid") ? st["pid"] : "?"));
        if (!noBrowser) OpenBrowserUrl(appUrl);
        else Console.WriteLine("打开：" + appUrl);
        Console.WriteLine("背景服务已启动；停止：MaoMaoEarth.exe stop（静态服务也会停止）。");
        return 0;
    }

    /// <summary>本地 MBTiles(SQLite) 瓦片服务：只监听 127.0.0.1，token 校验，按 z/x/y 查询。</summary>
    class MbtilesServer
    {
        const int SQLITE_OK = 0;
        const int SQLITE_ROW = 100;
        const int SQLITE_OPEN_READONLY = 1;

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_bind_int(IntPtr stmt, int index, int value);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_step(IntPtr stmt);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_column_blob(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_column_bytes(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_column_int(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_finalize(IntPtr stmt);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_close(IntPtr db);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_errmsg(IntPtr db);

        public string BaseUrl { get; private set; }
        public string Token { get; private set; }
        public string MetaJson { get; private set; }
        public int Port { get; private set; }

        readonly string dbPath;
        readonly string forcedToken;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        HttpListener listener;
        Thread thread;
        volatile bool running;

        public MbtilesServer(string path, string token) { dbPath = path; forcedToken = token; }

        public void Start()
        {
            ReadMetadata();
            FillMissingMeta();
            int p = MaoMaoEarthLauncher.FreePort(8140);
            if (p < 0) throw new Exception("找不到可用的 MBTiles 服务端口");
            listener = new HttpListener();
            while (true)
            {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + p + "/");
                try { listener.Start(); break; }
                catch
                {
                    try { listener.Close(); } catch { }
                    p = MaoMaoEarthLauncher.FreePort(p + 1);
                    if (p < 0) throw new Exception("无法绑定 MBTiles 服务端口");
                }
            }
            Port = p;
            Token = string.IsNullOrEmpty(forcedToken) ? Guid.NewGuid().ToString("N") : forcedToken;
            BaseUrl = "http://127.0.0.1:" + Port;
            MetaJson = BuildMetaJson();
            running = true;
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Start();
        }

        void Loop()
        {
            while (running && listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { if (!running) break; continue; }
                try { Handle(ctx); }
                catch (Exception ex)
                {
                    try { Respond(ctx, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("500 " + ex.Message)); } catch { }
                }
            }
        }

        void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            if (req.HttpMethod == "OPTIONS")
            {
                Respond(ctx, 204, null, null);
                return;
            }
            string token = req.QueryString["token"];
            if (string.IsNullOrEmpty(token) || token != Token)
            {
                Respond(ctx, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("403 invalid token"));
                return;
            }
            string path = req.Url.AbsolutePath;
            if (path == "/meta.json")
            {
                Respond(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(MetaJson));
                return;
            }
            if (path == "/health")
            {
                Respond(ctx, 200, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                return;
            }
            if (path.StartsWith("/tiles/", StringComparison.OrdinalIgnoreCase))
            {
                string rest = path.Substring("/tiles/".Length).Trim('/');
                string[] parts = rest.Split('/');
                if (parts.Length != 3)
                {
                    Respond(ctx, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("400 expected /tiles/z/x/y.ext"));
                    return;
                }
                int z, x, y;
                if (!int.TryParse(parts[0], out z) || !int.TryParse(parts[1], out x)) { Respond(ctx, 400, null, null); return; }
                string yText = parts[2];
                int dot = yText.IndexOf('.');
                if (dot >= 0) yText = yText.Substring(0, dot);
                if (!int.TryParse(yText, out y)) { Respond(ctx, 400, null, null); return; }
                if (z < 0 || z > 30) { Respond(ctx, 400, null, null); return; }
                int row = y;
                if (!IsXyzScheme()) row = (1 << z) - 1 - y;
                byte[] data = QueryTile(z, x, row);
                if (data == null || data.Length == 0)
                {
                    Respond(ctx, 204, null, null);
                    return;
                }
                string fmt = MetaValue("format", "").ToLowerInvariant();
                string ct = (fmt == "pbf" || fmt == "mvt") ? "application/x-protobuf" : SniffContentType(data);
                Respond(ctx, 200, ct, data);
                return;
            }
            Respond(ctx, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("404"));
        }

        bool IsXyzScheme()
        {
            string v;
            if (meta.TryGetValue("scheme", out v) && v != null && v.Trim().Equals("xyz", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        void Respond(HttpListenerContext ctx, int status, string contentType, byte[] body)
        {
            HttpListenerResponse res = ctx.Response;
            res.StatusCode = status;
            res.Headers["Access-Control-Allow-Origin"] = "*";
            res.Headers["Access-Control-Allow-Headers"] = "*";
            res.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
            res.Headers["X-Content-Type-Options"] = "nosniff";
            res.Headers["Cache-Control"] = status == 200 ? "public, max-age=86400" : "no-store";
            if (contentType != null) res.ContentType = contentType;
            if (body != null && body.Length > 0)
            {
                res.ContentLength64 = body.Length;
                res.OutputStream.Write(body, 0, body.Length);
            }
            else
            {
                res.ContentLength64 = 0;
            }
            res.OutputStream.Close();
        }

        static byte[] Utf8(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }

        static int OpenDb(string path, out IntPtr db)
        {
            return sqlite3_open_v2(Utf8(path), out db, SQLITE_OPEN_READONLY, IntPtr.Zero);
        }

        static string ColumnText(IntPtr stmt, int col)
        {
            IntPtr p = sqlite3_column_text(stmt, col);
            int n = sqlite3_column_bytes(stmt, col);
            if (p == IntPtr.Zero || n <= 0) return "";
            byte[] b = new byte[n];
            Marshal.Copy(p, b, 0, n);
            return Encoding.UTF8.GetString(b);
        }

        void ReadMetadata()
        {
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) throw new Exception("无法打开 MBTiles（winsqlite3）");
            try
            {
                IntPtr stmt;
                if (sqlite3_prepare_v2(db, Utf8("SELECT name,value FROM metadata"), -1, out stmt, IntPtr.Zero) == SQLITE_OK)
                {
                    try
                    {
                        while (sqlite3_step(stmt) == SQLITE_ROW)
                        {
                            string k = ColumnText(stmt, 0);
                            string v = ColumnText(stmt, 1);
                            if (!string.IsNullOrEmpty(k)) meta[k] = v;
                        }
                    }
                    finally { sqlite3_finalize(stmt); }
                }
            }
            finally { sqlite3_close(db); }
        }

        void FillMissingMeta()
        {
            bool needZoom = !meta.ContainsKey("minzoom") || !meta.ContainsKey("maxzoom");
            bool needBounds = !meta.ContainsKey("bounds");
            if (!needZoom && !needBounds) return;
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) return;
            try
            {
                if (needZoom)
                {
                    IntPtr stmt;
                    if (sqlite3_prepare_v2(db, Utf8("SELECT MIN(zoom_level),MAX(zoom_level),COUNT(*) FROM tiles"), -1, out stmt, IntPtr.Zero) == SQLITE_OK)
                    {
                        try
                        {
                            if (sqlite3_step(stmt) == SQLITE_ROW)
                            {
                                int minz = sqlite3_column_int(stmt, 0);
                                int maxz = sqlite3_column_int(stmt, 1);
                                int count = sqlite3_column_int(stmt, 2);
                                if (count <= 0) throw new Exception("MBTiles tiles 表为空");
                                if (!meta.ContainsKey("minzoom")) meta["minzoom"] = minz.ToString();
                                if (!meta.ContainsKey("maxzoom")) meta["maxzoom"] = maxz.ToString();
                            }
                        }
                        finally { sqlite3_finalize(stmt); }
                    }
                }
                if (needBounds) meta["bounds"] = "-180,-85,180,85";
            }
            finally { sqlite3_close(db); }
        }

        byte[] QueryTile(int z, int x, int row)
        {
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) return null;
            IntPtr stmt = IntPtr.Zero;
            try
            {
                string sql = "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1";
                if (sqlite3_prepare_v2(db, Utf8(sql), -1, out stmt, IntPtr.Zero) != SQLITE_OK) return null;
                sqlite3_bind_int(stmt, 1, z);
                sqlite3_bind_int(stmt, 2, x);
                sqlite3_bind_int(stmt, 3, row);
                if (sqlite3_step(stmt) != SQLITE_ROW) return null;
                IntPtr p = sqlite3_column_blob(stmt, 0);
                int n = sqlite3_column_bytes(stmt, 0);
                if (p == IntPtr.Zero || n <= 0) return null;
                byte[] data = new byte[n];
                Marshal.Copy(p, data, 0, n);
                return data;
            }
            finally
            {
                if (stmt != IntPtr.Zero) sqlite3_finalize(stmt);
                sqlite3_close(db);
            }
        }

        string MetaValue(string key, string def)
        {
            string v;
            return meta.TryGetValue(key, out v) && !string.IsNullOrEmpty(v) ? v : def;
        }

        string BuildMetaJson()
        {
            string format = MetaValue("format", "png").ToLowerInvariant();
            if (format == "jpeg") format = "jpg";
            string scheme = IsXyzScheme() ? "xyz" : "tms";
            string bounds = MetaValue("bounds", "-180,-85,180,85");
            string minzoom = MetaValue("minzoom", "0");
            string maxzoom = MetaValue("maxzoom", "22");
            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            JsonField(sb, "name", MetaValue("name", Path.GetFileNameWithoutExtension(dbPath)), true);
            JsonField(sb, "format", format, false);
            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "crs", MetaValue("crs", MetaValue("projection", "EPSG:3857")), false);
            JsonField(sb, "bounds", bounds, false);
            JsonNumber(sb, "minzoom", minzoom);
            JsonNumber(sb, "maxzoom", maxzoom);
            JsonField(sb, "attribution", MetaValue("attribution", "MBTiles"), false);
            JsonField(sb, "description", MetaValue("description", ""), false);
            sb.Append("}");
            return sb.ToString();
        }

        static void JsonField(StringBuilder sb, string key, string val, bool first)
        {
            if (!first) sb.Append(",");
            sb.Append("\"").Append(key).Append("\":\"").Append(JsonEscape(val)).Append("\"");
        }
        static void JsonNumber(StringBuilder sb, string key, string val)
        {
            int n;
            if (!int.TryParse(val, out n)) n = 0;
            sb.Append(",\"").Append(key).Append("\":").Append(n);
        }
        static string JsonEscape(string s)
        {
            if (s == null) return "";
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                switch (ch)
                {
                    case '\\': b.Append("\\\\"); break;
                    case '"': b.Append("\\\""); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default: if (ch < 32) b.Append("\\u").Append(((int)ch).ToString("x4")); else b.Append(ch); break;
                }
            }
            return b.ToString();
        }

        static string SniffContentType(byte[] d)
        {
            if (d.Length >= 8 && d[0] == 0x89 && d[1] == 0x50 && d[2] == 0x4E && d[3] == 0x47) return "image/png";
            if (d.Length >= 3 && d[0] == 0xFF && d[1] == 0xD8) return "image/jpeg";
            if (d.Length >= 12 && d[0] == 'R' && d[1] == 'I' && d[2] == 'F' && d[3] == 'F' && d[8] == 'W' && d[9] == 'E' && d[10] == 'B' && d[11] == 'P') return "image/webp";
            if (d.Length >= 6 && d[0] == 'G' && d[1] == 'I' && d[2] == 'F') return "image/gif";
            return "application/octet-stream";
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
