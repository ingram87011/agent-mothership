# Headfull Container — CLI Terminal

## Quick Connect
```bash
ssh user@localhost -p 2224    # password: user
ssh root@localhost -p 2224    # password: root
docker exec -it headfull bash  # or drop in directly
```

## Specs
| Resource | Value |
|---|---|
| Container | `headfull` (running, restart=unless-stopped) |
| OS | Ubuntu 24.04 |
| RAM | 15GB |
| CPUs | 4 |
| Storage | `/storage` → 467GB (503GB `/dev/sdc1`) |
| SSH | Port 2224 |
| Privileged | Yes |

## Installed Tools
- python3, pip, venv, dev headers
- git, curl, wget, cmake, build-essential
- jq, tmux, screen, vim, nano
- ripgrep (rg), bat, tree, htop, btop, neofetch
- ffmpeg, imagemagick, sqlite3
- nmap, net-tools, dnsutils
- p7zip, unzip, zip, rar
- trash-cli, fd-find, fzf, silversearcher-ag

## CLI-Anything (174 CLIs)
```bash
cli-hub list              # browse all
cli-hub search <query>    # search by keyword
cli-hub install <name>    # install a CLI
cli-hub launch <name>     # run installed CLI
```

Notable CLIs: blender, freecad, gimp, drawio, comfyui, audacity, n8n, ollama, calibre, obsidian, kdenlive, zotero

## Storage
- Mount point: `/storage`
- User dir: `/storage/user/`
- Custom bin: `/storage/user/bin/` (in PATH)
- Persistent mount via `/etc/rc.local`

## Shell Config
- Green prompt: `user@hostful:~/path$`
- Aliases: `ll`, `gs`, `gp`, `dc`, `dps`, `cli`

## Maintenance
```bash
docker exec headfull apt-get update && docker exec headfull apt-get upgrade -y
docker exec headfull cli-hub update <name>
docker exec headfull cli-hub uninstall <name>
```
