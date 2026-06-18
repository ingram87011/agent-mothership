# Relevant GitHub Repos — Ivanti LPE / DLL Proxying / RPC Abuse

## Top Picks

### 1. DLL Proxying Guide + Tools (itm4n)
- **Search**: itm4n.github.io/dll-proxying
- **Why**: Step-by-step DLL wrapper crafting (forwarding exports + DllMain payload). Perfect for STAgentUpdater/STServiceProcess proxy. Covers search order when main dir isn't writable.

### 2. Accenture/Spartacus — DLL/COM Hijacking Toolkit
- **https://github.com/Accenture/Spartacus**
- **Why**: Automated discovery & exploitation of DLL/COM hijacks. Scans vulnerable load paths, generates proxies, handles writable subdirs (Package/, Updates/ junction). Archived but gold.

### 3. wietze/windows-dll-hijacking — Vulnerable Binary List
- **https://github.com/wietze/windows-dll-hijacking**
- **Why**: CSV of ~300 hijackable exes + Sigma rules. Check STAgentUpdater.exe/STDispatch.exe against it. AppLocker bypass via trusted binaries.

### 4. PhantomRPC — RPC Impersonation PoCs
- **https://github.com/klsecservices/PhantomRPC**
- **Why**: ncalrpc endpoints (ST.Dispatch*), impersonation via RPC server registration/abuse. Relevant for failed ctypes/raw Ndr attempts.

### 5. Google Project Zero — Sandbox Attack Surface Analysis Tools
- **https://github.com/googleprojectzero/sandbox-attacksurface-analysis-tools**
- **Why**: RPC client generation from DLLs (parse STAgentFramework.dll/STDispatch.exe), ALPC transport, .NET/PowerShell integration. UAC bypass via RPC.

## Additional Strong Ones

- **trailofbits/RpcInvestigator**: GUI for exploring RPC interfaces/endpoints (ncalrpc, DispatchTask* methods).
- **warpnet/MS-RPC-Fuzzer**: Fuzz RPC methods — pair with paramData fuzzing on dispatch.
- **swisskyrepo/InternalAllTheThings** (Windows Privilege Escalation section): Cheatsheet for writable Tasks, service DLL hijacks, scheduled task races.

## Ivanti-Specific

- **CVE-2025-22458**: Recent Ivanti EPM DLL hijack in self-update tasks — mirrors junction/Package/ path. No public full PoC yet, but SEC Consult advisory details the ZIP + DLL pattern.
- **horizon3ai/Ivanti-EPM-Coercion-Vulnerabilities**: Coercion/registration angles.

## Strategy (from Grok)
1. Clone RPC tools + Spartacus/DLL proxy guides
2. Attack writable `Agent\STAgentUpdater\Package\` + junction during 1AM reset window
3. Combine proxy DLL + cloud checkin attempts
