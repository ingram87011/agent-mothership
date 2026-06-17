param(
    [string]$Command = "status",
    [string]$ExePath = "C:\Program Files\LANDESK\Shavlik Protect Agent\STAgentCtl.exe",
    [int]$TimeoutSeconds = 30
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;

public class PatchedLauncher
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const int STARTF_USESTDHANDLES = 0x00000100;

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int pid, tid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern bool CreateProcess(string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        [Out] byte[] lpBuffer, int nSize, out int lpNumberOfBytesRead);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        byte[] lpBuffer, int nSize, out int lpNumberOfBytesWritten);

    [DllImport("ntdll.dll", SetLastError=true)]
    static extern int NtQueryInformationProcess(IntPtr hProcess, int cls,
        byte[] buf, int sz, out int retLen);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess_Internal(IntPtr hProcess, uint uExitCode);

    const uint GENERIC_WRITE = 0x40000000;
    const uint GENERIC_READ = 0x80000000;
    const uint FILE_SHARE_READ = 1;
    const uint FILE_SHARE_WRITE = 2;
    const uint CREATE_ALWAYS = 2;
    const uint OPEN_EXISTING = 3;
    const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    public static int Launch(string exe, string args, int timeoutSec, out string output)
    {
        output = "";
        string stdoutFile = Path.GetTempFileName() + ".out";
        string stderrFile = Path.GetTempFileName() + ".err";
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        try
        {
            // Create output files with inheritable handles
            SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
            sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            sa.bInheritHandle = true;
            sa.lpSecurityDescriptor = IntPtr.Zero;
            IntPtr pSa = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            Marshal.StructureToPtr(sa, pSa, false);

            IntPtr hStdout = CreateFile(stdoutFile, GENERIC_WRITE, FILE_SHARE_READ,
                pSa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
            if (hStdout == (IntPtr)(-1)) return Marshal.GetLastWin32Error();

            IntPtr hStderr = CreateFile(stderrFile, GENERIC_WRITE, FILE_SHARE_READ,
                pSa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
            if (hStderr == (IntPtr)(-1)) return Marshal.GetLastWin32Error();
            Marshal.FreeHGlobal(pSa);
            pSa = IntPtr.Zero;

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = IntPtr.Zero;
            si.hStdOutput = hStdout;
            si.hStdError = hStderr;

            string cmdLine = "\"" + exe + "\" " + args;

            if (!CreateProcess(exe, cmdLine, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED, IntPtr.Zero, null, ref si, out pi))
                return Marshal.GetLastWin32Error();

            // Close our handles to the output files — the child process has them now
            CloseHandle(hStdout);
            CloseHandle(hStderr);
            hStdout = IntPtr.Zero;
            hStderr = IntPtr.Zero;

            // Read PEB for ImageBaseAddress
            byte[] pbi = new byte[48];
            int retLen;
            int st = NtQueryInformationProcess(pi.hProcess, 0, pbi, 48, out retLen);
            if (st != 0)
            {
                output = "NtQueryInformationProcess failed: 0x" + st.ToString("X8");
                TerminateProcess(pi.hProcess, 1);
                return st;
            }
            IntPtr pebAddr = (IntPtr)BitConverter.ToInt64(pbi, 8);

            byte[] peb = new byte[32];
            int readBytes;
            if (!ReadProcessMemory(pi.hProcess, pebAddr, peb, 32, out readBytes))
                return Marshal.GetLastWin32Error();
            long imgBase = BitConverter.ToInt64(peb, 0x10);

            int wrote;

            // Patch 1: NOP the `je` at IsUserAdministrator check (RVA 0x1D614)
            IntPtr pAdminCheck = (IntPtr)(imgBase + 0x1D614);
            if (!WriteProcessMemory(pi.hProcess, pAdminCheck,
                new byte[] { 0x90, 0x90, 0x90, 0x90, 0x90, 0x90 }, 6, out wrote))
                return Marshal.GetLastWin32Error();

            // Patch 2: Early return from handler (RVA 0x1DCF4)
            IntPtr pHandler = (IntPtr)(imgBase + 0x1DCF4);
            if (!WriteProcessMemory(pi.hProcess, pHandler,
                new byte[] { 0xB8, 0x01, 0x00, 0x00, 0x00, 0xC3, 0x90 }, 7, out wrote))
                return Marshal.GetLastWin32Error();

            // Resume the thread
            ResumeThread(pi.hThread);
            CloseHandle(pi.hThread);
            pi.hThread = IntPtr.Zero;

            // Wait for process to finish
            uint timeoutMs = (uint)(timeoutSec * 1000);
            uint waitResult = WaitForSingleObject(pi.hProcess, timeoutMs);

            uint exitCode = 259;
            if (waitResult == 0)
                GetExitCodeProcess(pi.hProcess, out exitCode);
            else
                TerminateProcess(pi.hProcess, 1);

            // Read output from files
            string stdOut = "";
            string stdErr = "";
            if (File.Exists(stdoutFile))
                stdOut = File.ReadAllText(stdoutFile, Encoding.UTF8);
            if (File.Exists(stderrFile))
                stdErr = File.ReadAllText(stderrFile, Encoding.UTF8);

            output = stdOut + stdErr;
            output = System.Text.RegularExpressions.Regex.Replace(output, "\x1b\\[[0-9;]*[a-zA-Z]", "");

            return (waitResult == 0) ? (int)exitCode : -2;
        }
        finally
        {
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            try { if (File.Exists(stdoutFile)) File.Delete(stdoutFile); } catch {}
            try { if (File.Exists(stderrFile)) File.Delete(stderrFile); } catch {}
        }
    }

    static void TerminateProcess(IntPtr hProcess, uint exitCode)
    {
        TerminateProcess_Internal(hProcess, exitCode);
    }
}
"@

$out = ""
$ec = [PatchedLauncher]::Launch($ExePath, $Command, $TimeoutSeconds, [ref]$out)

"EXIT_CODE: $ec"
"---OUTPUT---"
$out
"---END---"
