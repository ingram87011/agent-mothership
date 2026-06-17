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
**Status: Admin check bypass ACHIEVED AND CONFIRMED. `status`, `available-tasks`, `dispatch` all work.**

Binary patching via file modification triggers Windows Defender (blocks read/execute). **In-memory patching** using Add-Type C# works reliably:

**Patch technique (UPDATED June 17):**
1. Start STAgentCtl.exe suspended: `CreateProcess(exe, args, ..., CREATE_SUSPENDED)`
2. Get PEB: `NtQueryInformationProcess(hProcess, 0, pbi, 48, &retLen)` — **MUST use 48 bytes not 24** on x64
3. Read PEB at offset 8 → `ImageBaseAddress` at PEB offset 0x10
4. **Patch 1 — REAL fix at RVA 0x1D614**: NOP the `je` after IsUserAdministrator check (6 bytes: `0F 84 06 07 00 00` → `90 90 90 90 90 90`)
5. **Patch 2 — handler early return at RVA 0x1DCF4**: `B8 01 00 00 00 C3 90` (MOV EAX,1; RET; NOP) — belt-and-suspenders
6. ResumeThread, capture output via file-redirected handles

**Why `help` worked but RPC commands didn't (original approach):** Commands with selector 8 (like `help`) take an early-exit path (0x1D5F4) that never reaches the admin check. Commands with direct selectors (`status`/`dispatch`/`available-tasks`) flow through to 0x1D60A → IsUserAdministrator check → blocked.

**The "Unknown error" was a side-effect** of NOPing the error display at 0x1DD20 without fixing the admin check — execution continued past the NOP'd error into fallthrough code that produces "Unknown error".

**Result (with correct patches):**
- `help` → exit 0, full usage text
- `status` → exit 0, agent status (unregistered, no agent id)
- `available-tasks` → exit 0, 3 tasks listed
- `dispatch --index N` → exit 0, task runs as SYSTEM via STDispatch
- `dispatch --engine --operation --paramData` → exit 0, runs STAgentUpdater.exe as SYSTEM with raw paramData as arg

**Simplified version (no ConPTY):** `run_patched_simple.ps1` replaces `CreatePseudoConsole` with file-based stdout/stderr capture via `CreateFile` + `STARTF_USESTDHANDLES` + inheritable `SECURITY_ATTRIBUTES`. Avoids ConPTY deadlock that was hanging the original script.

### A2. ✅ SYSTEM Task Dispatch via Custom Engine/Operation (June 17)
**Status: CONFIRMED WORKING. `dispatch --engine --operation --paramData` runs STAgentUpdater.exe as SYSTEM.**

Custom dispatch confirmed via STDispatch log:
```
DispatchTask: engine b443f8a1-8af5-4f43-8537-467648fecc4c, operation 9d77c15b-2685-4223-8c50-17e989367eb0
Command line: "C:\Program Files\LANDESK\Shavlik Protect Agent\STAgentUpdater.exe" dummy
```
- `--paramData` is passed RAW as the command-line argument (no template/mapping applied)
- `--paramData -checkin` → runs STAgentUpdater.exe `-checkin` as SYSTEM (connects to configured console server)
- Registration state ("Not registered") does NOT block dispatch
- Only ONE engine available: STAgentUpdater.exe (GUID `b443f8a1-8af5-4f43-8537-467648fecc4c`)
- Only ONE operation: GUID `9d77c15b-2685-4223-8c50-17e989367eb0`
- STAgentUpdater.exe commands: `-checkin`, `-checkinAndUpdateAll`, `-updateBinaries`, `-updateData`, `-uninstall`, `-reset_counts` — none provide arbitrary code execution

### STEnginesCatalog.dll Analysis (June 17)
**NOT an engine registry!** This 967KB DLL is a **patch assessment catalog**:
- Exports 84 functions about patch detection, product dependencies, patch metadata
- Class names: `CPatchAssessmentCatalog`, `CPatchMetadataCatalog`, `CDetectableProducts`, `CProductDependencies`, `DPDFactory`
- Only engine class found: `STEngine` (generic base, no specific engine GUIDs or paths)
- No GUID-to-binary-path mappings found as ASCII strings or UTF-16 strings
- No .exe references found in the DLL (only standard Windows DLL imports)
- Conclusion: The engine mapping is **internal to STDispatch.exe** (not in a configurable file or registry key)

### 5 GUIDs in STDispatch/STAgentCtl — Identified as RPC UUIDs (June 17)
```
e2011457-1546-43c5-a5fe-008deee3d3f0
35138b9a-5d96-4fbd-8e2d-a2440225f93a
8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a
4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38
1f676c76-80e1-4239-95bb-83d0f6d0da78
```
Same GUIDs in both STDispatch.exe and STAgentCtl.exe. **Confirmed as RPC interface UUIDs:**
- All return "Invalid Task" when used as engine GUIDs in `dispatch --engine <GUID>`
- All return "Invalid Task" when used as operation GUIDs
- `STAgentCtl.exe` contains `CEngineRPCClient` and `CDispatchRpcTask` classes (connects via these endpoints)
- The GUIDs correspond to the 6 ncalrpc endpoints enumerated earlier

### Task File Format Unknown (June 17)
- Log references `tasks/GUID.txt` (relative path from STDispatch working dir)
- Files are created during dispatch and immediately deleted after completion
- `C:\Windows\System32\tasks\` is writable by standard user but no files persist
- Could not capture task file content via polling (file created/deleted too fast)
- Format remains unknown — prevents planting custom task files for arbitrary SYSTEM execution

### Python Ghost Folders — User Level Only (June 17)
```
HKLM: C:\Program Files\Python310\Lib\;C:\Program Files\Python310\DLLs\
HKCU: C:\Windows\Tasks\Lib\;C:\Windows\Tasks\DLLs\;C:\Windows\Tasks\
```
- HKCU path gives user-level (LC2022) Python import hijacking via ghost folders
- No `_pth` file exists in Python310 dir (so registry paths ARE used)
- No SYSTEM process on this PC loads Python natively — ghost folders don't give SYSTEM

### Remaining Attack Vectors (Re-prioritized June 17)

**A. Direct RPC via NdrClientCall3 (HIGH)**
All 6 endpoints bind without authentication. The MIDL format strings exist in `STAgentFramework.dll` (2.1MB .NET assembly — decompilable with dnSpy/ILSpy). If extracted, `NdrClientCall3` can call `DispatchTask` or `DispatchCheckInAndUpdateAll` directly with SYSTEM privileges — bypassing both the admin check AND STAgentCtl.exe entirely.

**B. DLL Hijacking via Dispatched Process (MEDIUM)**
Need to determine STDispatch's current directory when spawning engines via `CreateProcess`. If the current directory is writable (e.g., `C:\Windows\Tasks\` or `C:\ProgramData\`), plant a DLL that STAgentUpdater.exe loads via DLL search order.

**C. 1AM Reset Race (MEDIUM)**
PC reboots nightly at 1AM. STDispatch stops and restarts. Brief window for file replacement, junction creation, or config tampering during service restart. C:\ is wiped nightly but LANDESK dir survives.

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
- ~~**Admin check bypass → "Unknown error":** Admin check is bypassed (help works), but RPC commands (status, dispatch) fail with "Unknown error" at 0x34930. Cause unknown: could be skipped initialization, second admin check, or unregistered agent state.~~ **RESOLVED: NOP the `je` at the IsUserAdministrator check (RVA 0x1D614) instead of NOPing the error display. See CONTEXT.md.**

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
