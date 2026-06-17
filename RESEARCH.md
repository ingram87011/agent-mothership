# Research: Ivanti Security Controls Agent (STDispatch) Privilege Escalation

**Target:** ABPCP532 (Windows 10 22H2, build 19045.5131, Dec 2024 patches)  
**User:** LC2022 (standard user, no admin)  
**Product:** Ivanti Security Controls Agent v9.4.34497.0  
**Path:** `C:\Program Files\LANDESK\Shavlik Protect Agent\`

## Architecture

### Services
| Service | Display Name | State | User | Binary |
|---------|-------------|-------|------|--------|
| `STDispatch$Shavlik Protect` | Ivanti Security Controls Agent Dispatcher | **Running** | LocalSystem | `STDispatch.exe` (PID 4188) |
| `STAgent$Shavlik Protect` | Ivanti Security Controls Agent | **Stopped** | NetworkService | `STAgent.exe` (909KB) |

Service SD: `D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)`
- Interactive Users (IU): QUERY_CONFIG + QUERY_STATUS + ENUM_DEP + INTERROGATE + USER_DEFINED_CONTROL + READ_CONTROL
- **No start/stop rights for non-admin users**

### Agent Registration State
- `store.dat` = 0 bytes (**NOT registered** — empty `agentId=""`)
- `dataCache.dat` contains pending `RegisterAgent` event
- `AgentEnvironment.config` has empty `agentId=""` and `consoleCertificateSerialNumber=""`
- Console URI: `//patchlink5.staff.local:3121/ST/Console/AgentState/v2`
- Cloud URI: `https://isec.ivanticloud.com/privateapi`
- The 1AM nightly wipe resets `C:\` but **preserves** `C:\ProgramData\LANDESK\Shavlik Protect\Agent\`

### STDispatch.exe (SYSTEM Process)
- 451KB native C++, imports rpcrt4.dll, ole32.dll, wtsapi32.dll
- Runs continuously as LocalSystem (PID 4188, auto-start)
- Exposes 5 registered ncalrpc interfaces (6 endpoints) via `LrpcServer.cpp`
- Listens on endpoints: `ST.DispatchEvents`, `STDisp-EventSink`, `STDisp-FTQ`, `STN.Dispatch`, `STN.Core`, `STN.Core.Security`
- Does **NOT** authenticate server-side (all 6 endpoints bind without ACCESS_DENIED from low-privilege)

### STAgentFramework.dll (2.1MB)
- Only imports ole32.dll — uses COM ORPC protocol internally
- Contains: `CDispatchRpcClient`, `CDispatchRpcServer`, `CDispatchManager`, `CDispatchEventList`
- RPC methods: `DispatchTask`, `DispatchTaskById`, `DispatchCheckInAndUpdateAll`, `DispatchJobById`, `DispatchJob`
- Additional endpoint: `ST.DispatcherEngineEventSink-9A` (event sink)

### STAgentCtl.exe (304KB CLI Tool)
- Full command-line interface with these commands:
  - `dispatch --engine --operation --paramData` — Start a job via RPC to STDispatch!
  - `dispatch --index` — Start job by index
  - `register --host --port --passphrase` — Register with console
  - `register --cookie --enrollmentkey` — Register with cloud server
  - `status` — Show agent status
  - `update --checkin/--all/--binaries/--updateData` — Update agent
  - `send-telemetry` — Force send telemetry
  - `available-tasks` — List available tasks
  - `uninstall` — Uninstall agent
- **Client-side admin check:** `"This operation requires administrative rights"` at file offset `0x349E0`
- Admin check uses `OpenProcessToken` (not `IsUserAnAdmin` or `CheckTokenMembership` by import name)
- Cannot be run directly by standard user; binary at `C:\Program Files\` is read-only
- Can be copied to `C:\Windows\Tasks\` (AppLocker-allowed), then patched to bypass admin check

### Key Binaries on Disk
All at `C:\Program Files\LANDESK\Shavlik Protect Agent\`:
- STDispatch.exe (451KB) — SYSTEM RPC dispatcher
- STAgent.exe (909KB) — agent service binary
- STAgentCtl.exe (304KB) — CLI control tool (admin gated)
- STAgentFramework.dll (2.1MB) — managed dispatch logic, COM ORPC
- STCore.dll (1MB) — core library
- STAgentManagement.exe (480KB) — registration tool
- STAgentUpdater.exe (1.1MB) — update downloader
- STAgentUI.exe (910KB) — tray UI
- STScheduler.dll (206KB) — task scheduling
- wastorage.dll (3.3MB) — storage library
- STEnginesCatalog.dll (967KB) — patch engines catalog
- SafeReboot.exe (1MB) — reboot utility

### dataCache.dat Format
Path: `C:\ProgramData\LANDESK\Shavlik Protect\Agent\dataCache.dat`

```
Offset  Size  Field
0       4     uint32 data_length (LE)
4       4     char[4] "Data" magic
8       4     uint32 field1 (possibly max size)
12      4     uint32 padding (0)
16      N     UTF16-LE JSON content
```

Sample content:
```json
{"eventData":[{"name":"Command","value":"RegisterAgent"},{"name":"agent id","value":""},{"name":"console id","value":""},{"name":"platform version","value":"9.4.34828.0"},{"name":"sdk version","value":"9.4.34497.0"},{"name":"brand","value":"Ivanti Security Controls Agent"}],"iKey":"ea0cfc99-c1e8-4a27-804b-8e7e31170adb","name":"STAgentManagement Process Start","time":"2022-09-13T13:53:11.6516723Z"}
```

## LRPC/RPC Results

### Endpoint Binding (All SUCCESS from low-privilege)
All 6 endpoints bind via `RpcBindingFromStringBinding` without ACCESS_DENIED (0x5):

| Endpoint | Bind Result |
|----------|-------------|
| `ST.DispatchEvents` | BOUND |
| `STDisp-EventSink` | BOUND |
| `STDisp-FTQ` | BOUND |
| `STN.Dispatch` | BOUND |
| `STN.Core` | BOUND |
| `STN.Core.Security` | BOUND |

All 36 UUID+endpoint combinations resolve via epmapper.  
Management API (`RpcMgmtIsServerListening`) returns 0x6B3 (RPC_S_SERVER_UNAVAILABLE).

### COM Activation
- `GetTypeFromCLSID(<UUID>)` returns `__ComObject` — UUIDs known to COM runtime
- `CreateInstance()` fails with `REGDB_E_CLASSNOTREG` — no class factories registered
- Registration-free COM manifest **not present** (no `.manifest` files, no embedded RT_MANIFEST)
- `CoGetObject("ncalrpc:STN.Core")` moniker syntax fails with MK_E_SYNTAX
- Raw ALPC port connect via `NtConnectPort` fails with `STATUS_OBJECT_NAME_NOT_FOUND` (port names mangled differently than `\RPC Control\STN.Core`)

### File Drop Attack (New\ and FTQ\ Directories)
Files dropped in `C:\ProgramData\LANDESK\Shavlik Protect\Agent\New\` and `FTQ\` **are NOT consumed** by STDispatch. After hours of observation, files remain untouched. STDispatch likely:
- Does not poll these directories (no FileSystemWatcher or timer-based polling)
- Only processes files when triggered by RPC command (via `DispatchTask`)
- May require registered agent state (`store.dat`) before processing

## Writable Directories (LANDESK)
| Directory | Access | Notes |
|-----------|--------|-------|
| `Agent\` | Users Write | Survives 1AM wipe |
| `Agent\New\` | Users Write | Not consumed |
| `Agent\Old\` | Users Write | Unused |
| `Agent\FTQ\` | Users Write | Not consumed |
| `Agent\Updates\` | LC2022 FullControl | Junction to `C:\Windows\Tasks\` — SYSTEM-owned, cannot modify |
| `Agent\CustomUpdate\` | Users Write | Empty |
| `Logs\` | Users Write | STDispatch debug logging |

## Store.dat Format (Anti-patterns)
- Expects binary header matching `Data` magic (not plain JSON, not XML)
- store.dat at 0 bytes means agent never registered
- Replacing contents of store.dat with dataCache.dat format caused STAgent to briefly appear (PID 2920, 0.06s CPU) then exit — binary format IS recognized but registration validation fails
- Registration check: `STAgent.cpp:209` checks in native C++ code BEFORE managed code loads
- Must run as service via SCM (ServiceBase.cpp) — direct Start-Process exits immediately

## Attack Vectors (Priority Order)

### A. ✅ Patch STAgentCtl.exe Admin Check — IN-MEMORY (HIGH, DONE)
**Status: Admin check bypass ACHIEVED. But RPC commands still fail with "Unknown error".**

Binary patching via file modification triggers Windows Defender (blocks read/execute). **In-memory patching** using Add-Type C# works reliably:

**Patch technique:**
1. Start STAgentCtl.exe suspended: `CreateProcess(exe, args, ..., CREATE_SUSPENDED)`
2. Get PEB: `NtQueryInformationProcess(hProcess, 0, pbi, 48, &retLen)` — **MUST use 48 bytes not 24** on x64
3. Read PEB at offset 8 → `ImageBaseAddress` at PEB offset 0x10
4. **Patch 1** (admin check function return): `WriteProcessMemory(hp, ImageBase+0x1DCF4, [0xB8,0x01,0,0,0,0xC3,0x90])`
   - Replaces `33 C9 E8 25 E8 FE FF` (XOR ECX,ECX; CALL admin_check) with `B8 01 00 00 00 C3 90` (MOV EAX,1; RET; NOP)
5. **Patch 2** (error display NOP): `WriteProcessMemory(hp, ImageBase+0x1DD20, 12x 0x90)`
   - NOPs `48 8D 0D B9 7E 01 00 E8 F4 E7 FE FF` (LEA error_string; CALL error_display)
6. ResumeThread, capture output via file-redirected handles

**Result:** `help` works (exit 0, full usage text). `status`/`available-tasks`/`dispatch` return exit -1 with "Unknown error".

**Error string locations:**
- `"This operation requires administrative rights"` at file offset `0x349E0`, RVA `0x35BE0`, referenced by LEA at 0x1D120
- `"Unknown error"` at file offset `0x34930`, RVA `0x35B30`, referenced by LEA at 0x1C5E8

**File patching fails:** Modified STAgentCtl.exe written to C:\Windows\Tasks\ is blocked by Windows Defender (access denied on read/execute). Python-written copies get flagged immediately. In-memory avoids this.

**Output capture requires:** `CreateFile` + `SetHandleInformation(h, HANDLE_FLAG_INHERIT, 1)` + `STARTF_USESTDHANDLES`. Anonymous pipes don't work for console apps; file handles do.

**C# code structure:** Add-Type with P/Invoke to kernel32 (CreateProcess, Read/WriteProcessMemory, NtQueryInformationProcess, CreateFile, SetHandleInformation, ResumeThread, WaitForSingleObject).

### B. Direct RPC Call via NdrClientCall3 (HIGH)
All 6 endpoints bind without authentication. The MIDL format strings exist in `STAgentFramework.dll` and `STDispatch.exe`. If extracted, `NdrClientCall3` can call `DispatchTask` or `DispatchCheckInAndUpdateAll` directly with SYSTEM privileges — bypassing both the admin check AND STAgentCtl.exe entirely.

### C. Print Spooler Junction (MEDIUM — untested)
`C:\Windows\System32\spool\PRINTERS` is writable. Microsoft XPS Document Writer available. If spoolsv.exe follows a junction point, a SYSTEM file write to `C:\Program Files\LANDESK\...` might be achievable despite Dec 2024 patches (Gemini: likely mitigated).

### D. 1AM Reset Window (LOW)
PC resets nightly at 1AM. STDispatch stops/restarts. A brief window exists for timed attacks (file replacement, junction creation, race conditions).

### E. Python Ghost Folders (LOW — no trigger found)
`HKCU\Software\Python\PythonCore\3.10\PythonPath` = `C:\Windows\Tasks\Lib\;C:\Windows\Tasks\DLLs\;C:\Windows\Tasks\`
Directories created with `sitecustomize.py` backdoor. No SYSTEM process on this PC invokes Python.exe natively.

## Failed/Blocked Approachs
- **NTFS Junction to SYSTEM-owned dirs:** Cannot modify existing `Updates` junction (SYSTEM-owned, no SeBackupPrivilege)
- **WMI Permanent Events:** Can read `root\subscription`, cannot write (access denied)
- **BITS SetNotifyCmdLine:** COM interface works, Avecto may block execution
- **COM CreateInstance:** `REGDB_E_CLASSNOTREG` for all 6 UUIDs
- **ALPC raw packet:** `NtConnectPort` → `STATUS_OBJECT_NAME_NOT_FOUND` on `\RPC Control\*` port names
- **STAgent service start:** Blocked by Avecto (SCM hooks)
- **SCHTASKS create:** Blocked by Avecto for all task creation
- **Printer Driver EoP:** Mitigated by Dec 2024 patches (`RestrictDriverInstallationToAdministrators`)
- **File patching STAgentCtl.exe:** Windows Defender blocks modified binary (access denied on read/execute). In-memory patching bypasses this.
- **Admin check bypass → "Unknown error":** Admin check is bypassed (help works), but RPC commands (status, dispatch) fail with "Unknown error" at 0x34930. Cause unknown: could be skipped initialization, second admin check, or unregistered agent state.

## Important File Locations
- `dataCache.dat`: `Agent\dataCache.dat` — event cache, 816 bytes
- `store.dat`: `Agent\store.dat` — 0 bytes (not registered)
- `AgentEnvironment.config`: `Program Files\LANDESK\Shavlik Protect Agent\AgentEnvironment.config`
- `STDispatch.exe.config`: Same directory — logging config, `enableDebugLaunch="false"`
- `STDispatch.log`: `ProgramData\LANDESK\Shavlik Protect\Logs\STDispatch.log`
- `Python310`: `C:\Program Files\Python310\` — no `python._pth` file (reads HKCU PythonPath)

## PE Layout (STAgentCtl.exe)
304KB native x64 binary:
| Section | RVA | Size | File Offset |
|---------|------|------|-------------|
| .text | 0x1000 | 0x2D8CE | 0x400 |
| .rdata | 0x2F000 | 0x153C8 | 0x2DE00 |
| .data | 0x45000 | 0x1DF0 | 0x43200 |
| .pdata | 0x47000 | 0x216C | 0x44000 |
| .rsrc | 0x4A000 | 0xAD8 | 0x46200 |
| .reloc | 0x4B000 | 0x344 | 0x46E00 |

DLL imports: KERNEL32, ADVAPI32, SHELL32, ole32, OLEAUT32, STAgentFramework, MSVCP140, STCore, STServiceProcess, WS2_32, VCRUNTIME140, SHLWAPI, USERENV, PSAPI

**Error strings:**
- `"This operation requires administrative rights"` at file offset `0x349E0`, RVA `0x35BE0`, LEA reference at file offset `0x1D120` (RVA `0x1DD20`)
- `"Unknown error"` at file offset `0x34930`, RVA `0x35B30`, LEA reference at file offset `0x1C5E8` (RVA `0x1D1E8`)
