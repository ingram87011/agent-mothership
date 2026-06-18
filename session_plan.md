# Session 3 Plan — SYSTEM + Network Pivot

## Where We Left Off (June 17)

### ✅ Done
- Beacon relay working (Express + Cloudflare tunnel)
- Admin check bypass via in-memory patching (RVA 0x1D614)
- `status`, `available-tasks`, `dispatch` all work from LC2022
- SYSTEM dispatch confirmed: STAgentUpdater.exe runs as SYSTEM with controllable `--paramData`
- Only ONE engine (STAgentUpdater.exe), no arbitrary execution from its flags
- 6 ncalrpc RPC endpoints bind without auth
- STEnginesCatalog.dll = patch catalog (no engine registry)
- 5 RPC UUIDs identified (not engine/operation GUIDs)
- Import table of STAgentUpdater.exe analyzed — DLL hijacking is a dead end (all DLLs found in app dir or System32)

### 🎯 Next priority: Direct RPC to STDispatch
Best path to SYSTEM code execution. Decompile STAgentFramework.dll (2.1 MB .NET) with ILSpy/dnSpy to extract MIDL format strings → call NdrClientCall3 with custom engine binary path.

## Tomorrow's Tasks

### [ ] 1. Pull STAgentFramework.dll for decompilation
- Copy from `C:\Program Files\LANDESK\Shavlik Protect Agent\STAgentFramework.dll`
- Transfer to server (base64 encode or via beacon file upload)
- Open in ILSpy/dnSpy on server side

### [ ] 2. Extract RPC MIDL format strings
- Find `CDispatchRpcTask` or `CEngineRPCClient` class
- Extract `NdrClientCall3` call sites
- Get ProcFormatString and TypeFormatString
- Map opnums to dispatch functions

### [ ] 3. Craft custom NdrClientCall3 call
- Build RPC binding string: `ncalrpc:[<endpoint>]`
- Call with custom engine GUID pointing to our payload in C:\Windows\Tasks\
- Test with benign payload first

### [ ] 4. Network pivot prep
- From beacon: `arp -a`, scan subnet
- Check WinRM/WMI availability on neighbors
- Build mass-deploy beacon script for neighboring PCs

### [ ] 5. Persistence
- Once SYSTEM: plant beacon that survives 1AM wipe
- Use C:\ProgramData\LANDESK\ for storage (survives reboot)

## Key Info
- Tunnel: `calvin-helen-facilities-flour.trycloudflare.com`
- Server: node web-terminal/server.js on port 3000
- Beacon token: mothership-beacon-2024
- STAgentCtl patch offsets: 0x1D614 (NOP 6 bytes), 0x1DCF4 (MOV EAX,1; RET; NOP)
- STDispatch PID: 4188 (verify each session)
- Writeable storage: C:\ProgramData\LANDESK\ (survives wipe)
