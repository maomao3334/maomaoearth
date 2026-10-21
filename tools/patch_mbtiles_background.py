p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
old='''        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        MbtilesServer server;
        try
        {
            server = new MbtilesServer(full, null);
            server.Start();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("MBTiles 服务启动失败：" + ex.Message);
            return 1;
        }
        string appUrl = "http://127.0.0.1:" + port + "/?mbtiles=" + Uri.EscapeDataString(server.BaseUrl) + "&mbtoken=" + Uri.EscapeDataString(server.Token);
        Console.WriteLine("MBTiles 已挂载：" + full);
        Console.WriteLine("MBTILES_SERVER=" + server.BaseUrl);
        Console.WriteLine("MBTILES_TOKEN=" + server.Token);
        Console.WriteLine("MBTILES_META=" + server.BaseUrl + "/meta.json?token=" + server.Token);
        Console.WriteLine("MBTILES_APP=" + appUrl);
        if (!noBrowser) OpenBrowserUrl(appUrl);
        else Console.WriteLine("打开：" + appUrl);
        Console.WriteLine("请保持此窗口运行；关闭窗口或按 Ctrl+C 即停止 MBTiles 服务。");
        while (true) Thread.Sleep(500);
'''
new='''        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        StopMbtilesService(false);
        string statePath = MbtilesStatePath;
        string token = Guid.NewGuid().ToString("N");
        try { File.WriteAllText(statePath + ".tok", token, new UTF8Encoding(false)); } catch { }
        try
        {
            StartDetachedProcess("__mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"");
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
'''
assert old in c, 'block anchor missing'
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('background OpenMbtiles patched')
