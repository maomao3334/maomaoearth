p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
start=c.find('    static int OpenMbtiles(')
end=c.find('    /// <summary>本地 MBTiles', start)
assert start>0 and end>start
new=r'''    static int OpenMbtiles(string file, int port, bool noBrowser)
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
    }

'''
c=c[:start]+new+c[end:]
open(p,'w',encoding='utf-8',newline='').write(c)
print('reverted to foreground')
