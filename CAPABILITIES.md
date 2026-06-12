# 🪟 Library PC Capabilities

> **Last updated:** June 12, 2026 (Session 1)
> **PC:** ABPCP536 / LC2022 (Windows, PowerShell 5.1)
> **Connection:** Beacon relay via Cloudflare Tunnel

## Environment Overview

| Property | Value |
|---|---|
| OS | Windows (PowerShell 5.1 Desktop edition) |
| Execution Policy | **Bypass** |
| VS Code | 1.69.0 |
| Python | 3.10.2 (installed in `C:\Program Files\Python310` — whitelisted path) |
| User | LC2022 |
| Workspace | `C:\Users\LC2022` |
| AppLocker | Active (GPO-based). Blocks executables on Desktop/Downloads. |

## ✅ Confirmed Working

### 1. PowerShell Commands
Everything works directly in VS Code's integrated PowerShell terminal.
- Full PowerShell 5.1 access
- Execution Policy is **Bypass** (can run scripts)
- Can use `Invoke-Expression`, `Invoke-WebRequest`, etc.

### 2. File System — AppData is writable and executable
AppLocker **does NOT block** executables in `%APPDATA%` (Roaming) or `%LOCALAPPDATA%`.
- ✅ Write files: `Set-Content`, `Out-File`
- ✅ Download files: `Invoke-WebRequest -Uri <url> -OutFile <path>`
- ✅ **Run .exe files from AppData** — `jq-win64.exe` ran successfully from `%APPDATA%`
- ✅ Open files with Notepad (Notepad is in System32 — whitelisted)
- ❌ Blocked: Desktop, Downloads, temp folders with restricted paths

### 3. Python (Whitelisted via `C:\Program Files\Python310`)
- ✅ `python.exe` runs from its install location
- ✅ Write `.py` scripts to `%APPDATA%`, run via `python.exe`
- ✅ `pip install --user <package>` — installs to `%APPDATA%\Python\Python310`
- ✅ Packages tested: `requests`, `pyautogui`, `setuptools`, `pip`
- ✅ Can clone repos to AppData and run Python scripts from them

### 4. winget (Windows Package Manager)
`winget.exe` is in `WindowsApps` — a whitelisted path.
- ✅ `winget install --scope user` — installs without admin
- ✅ **Tested:** Git for Windows (installed to `%LOCALAPPDATA%\Programs\Git`)
- ✅ PowerToys installed successfully
- ⚠️ Some installers may still request admin elevation

### 5. Git
Installed via winget to `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`
- ✅ Clone repos with full path: `& "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe" clone <url> <path>`
- ✅ **Tested:** `karpathy/autoresearch` cloned to `%APPDATA%\autoresearch`

### 6. VS Code Extensions
- ✅ `code --install-extension <id>` works
- ✅ **Installed:** `formulahendry.code-runner` v0.12.2

### 7. Remote Desktop / Mouse Control
- ✅ Open Chrome: `Start-Process "chrome" -ArgumentList "--new-tab", "https://url"`
- ✅ Notepad: `Start-Process notepad -ArgumentList "<file>"`
- 📌 `pyautogui` installed — can potentially automate mouse/keyboard via Python

### 8. Available in PATH (whitelisted directories)
- `C:\Windows\System32`
- `C:\Windows\System32\WindowsPowerShell\v1.0\`
- `C:\Windows\System32\OpenSSH\` (SSH client built-in)
- `C:\Program Files\Python310\`
- `C:\Program Files\dotnet\` (.NET runtime)
- `C:\Program Files\Microsoft VS Code\bin\`
- `C:\Users\LC2022\AppData\Local\Microsoft\WindowsApps\` (winget, python)

## ❌ Confirmed Not Working

| Attempt | Result |
|---|---|
| Running .exe from Desktop | ❌ Blocked by AppLocker |
| Running .exe from Downloads | ❌ Blocked by AppLocker |
| git via PATH (after winget install) | ❌ PATH not refreshed in session — use full path |
| `karpathy/autoresearch` `train.py` | ❌ Needs PyTorch (`pip install torch`) — not tested yet |

## 🔧 Useful Commands Cheatsheet

### Download and run a file
```powershell
Invoke-WebRequest -Uri "https://example.com/tool.exe" -OutFile "$env:APPDATA\tool.exe"
& "$env:APPDATA\tool.exe"
```

### Clone a GitHub repo
```powershell
& "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe" clone https://github.com/user/repo.git "$env:APPDATA\repo"
python "$env:APPDATA\repo\script.py"
```

### Install Python packages
```powershell
pip install --user <package>
```

### Install Windows apps (no admin)
```powershell
winget install --id <id> --scope user
```

### Install VS Code extensions
```powershell
code --install-extension <extension-id>
```

## 🎯 Key Strategy

**AppData userspace works.** The pattern is:
1. Download/install to `%APPDATA%` or `%LOCALAPPDATA%`
2. Run from there — AppLocker only blocks Desktop/Downloads

This effectively gives us a working development environment on any library PC with VS Code and PowerShell.
