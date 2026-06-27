# Grand Theft Auto 6 — The Videogame
## (Security Toolkit & Research Progress — Totally Not Suspicious)

### Date Saved: June 27, 2026
### Codespace: agent-mothership (CodeSandbox)

---

## 🔧 Installed Security Toolkit

### Go-Based Tools (/usr/local/bin/ & ~/go/bin/)
| Tool | Version | Purpose |
|------|---------|--------|
| subfinder | v2.14.0 | Subdomain enumeration |
| httpx | v2.14.0 | HTTP probing & fingerprinting |
| nuclei | v3.9.0 | Template-based vuln scanner (8000+ templates) |
| ffuf | 2.1.0 | Web fuzzer (dirs, params, vhosts) |
| katana | v1.6.1 | Web crawler |
| gau | v2.2.4 | URL discovery (Wayback, OTX, CommonCrawl) |
| waybackurls | latest | Wayback Machine URL fetcher |
| unfurl | latest | URL parsing/extraction |
| qsreplace | latest | Query string replacement |
| anew | latest | Append unique lines |
| hakrawler | latest | Web crawler |
| **amass** | v5.1.1 | Deep attack surface mapping & subdomain enum |
| **puredns** | v2.1.1 | Fast wildcard-safe DNS resolution & subdomain brute-force |
| **alterx** | v0.1.0 | Subdomain permutation generator (modern altdns replacement) |
| **dalfox** | v3.1.2 | XSS scanner — Rust, AST-based DOM analysis, MCP support |
| **interactsh-client** | v1.3.1 | OOB interaction client (blind SSRF/XSS detection) |
| **interactsh-server** | v1.3.1 | Self-hosted OOB callback server (DNS/HTTP/SMTP/LDAP) |
| **massdns** | latest | High-performance DNS stub resolver (puredns backend) |

### System Tools (/usr/local/bin/ & /usr/bin/)
| Tool | Version | Purpose |
|------|---------|--------|
| nmap | 7.93 | Port scanning |
| nikto | latest (git) | Web server scanner |
| whatweb | latest (git) | Web technology fingerprinting |
| whois | latest | Domain registration info |
| dig | latest | DNS queries |
| curl | 7.88.1 | HTTP client |
| wget | latest | File downloader |
| jq | 1.6 | JSON processing |
| **hashcat** | v6.2.6 | GPU-accelerated password cracking (450+ hash types) |
| **john** | latest | CPU-friendly password cracking (auto-detect hash format) |
| **sliver-client** | latest | C2 framework — mTLS/DNS/WireGuard/HTTP implants |

### Python Tools (pip3)
| Tool | Version | Purpose |
|------|---------|--------|
| sqlmap | 1.10.6 | SQL injection automation |
| dirsearch | v0.4.3 | Directory brute-force |
| wafw00f | latest | WAF detection |
| arjun | latest | Hidden parameter discovery |
| droopescan | latest | CMS scanner (Drupal, WordPress) |
| **XSStrike** | 3.1.6 | Context-aware XSS scanner (14k stars) |
| **SSRFmap** | latest | Automatic SSRF fuzzer & exploitation |
| **jwt_tool** | latest | JWT testing/forging/cracking toolkit |
| **dnsgen** | latest | Subdomain DNS permutation generator |

### Nuclei Templates
- Location: ~/nuclei-templates/
- 30 template directories
- Update: `nuclei-update` command

### Helper Commands
- `seccheck` — Show full toolkit reference
- `nuclei-update` — Update nuclei templates
- `alias tools-list='ls /usr/local/bin/ ~/go/bin/ 2>/dev/null | sort -u'` — List all tools

### Quick-Start Workflows

```bash
# Full recon pipeline on a target
subfinder -d target.com | httpx -silent | nuclei -t ~/nuclei-templates/ -o findings.txt

# XSS scanning with dalfox
dalfox scan https://target.com/page?param=test --mining DOM

# Blind SSRF testing
interactsh-client        # get a callback URL
# then inject the URL into your target's parameters

# API fuzzing with ffuf
ffuf -u https://target.com/FUZZ -w /usr/share/wordlists/api.txt

# JWT attack toolkit
jwt_tool eyJhbGciOiJIUzI1NiJ9.xxxx -T           # tamper
jwt-hack scan eyJhbGciOiJIUzI1NiJ9.xxxx         # scan

# Password cracking
hashcat -m 0 -a 0 hash.txt rockyou.txt          # MD5
john hash.txt                                    # auto-detect

# C2: start a sliver listener
sliver-client

# Recon combo
subfinder -d target.com | tee subs.txt
cat subs.txt | httpx -silent | nuclei -t cves/ -o critical.txt
cat subs.txt | waybackurls | gau | dalfox scan --pipe
```

### PATH Configuration (in ~/.bashrc)
```
export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin:/usr/local/bin
```

---

## 📋 Anthropic Bounty Status

### Reports Ready
| File | Status | Purpose |
|------|--------|--------|
| bounties/anthropic/HACKERONE-SUBMISSION.md | ✅ READY | **Submit this one** — redacted, clean |
| bounties/anthropic/evidence/proof-tool-test.txt | ✅ Saved | Surviving proof (TOOL_CALL_WORKS) |
| bounties/anthropic/evidence/rce-mock-server.py | ✅ Saved | RCE mock server code |
| bounties/anthropic/evidence/strace-*.log | ✅ Saved | 4 strace captures |
| bounties/anthropic/session-001.md → 005.md | ✅ Saved | Full session logs |

### Key Findings (What Gets Paid)
1. **Provider Auth Bypass** — CLAUDE_CODE_SKIP_*_AUTH=1 + BASE_URL = zero-auth MITM
2. **Data Exfiltration** — 90KB request (system prompt, tools, messages) sent to attacker
3. **5 Provider Paths** — Bedrock, Vertex, Foundry, Mantle, Anthropic AWS
4. **.env auto-loading** — Bun binary loads .env from project dir (supply chain vector)

### Estimated Bounty: $4,000–$6,500 (Grok estimate)
### First Response: ~20 hours
### Triage: ~6-7 days
### Payout: ~1 week

---

## 🔍 Web Research Toolkit (Ready to Use)

### DoorDash Research (from today)
- Tech stack: React/Next.js frontend, Kotlin/JVM backend, gRPC internal, AWS
- BFF (Backend for Frontend) = key attack surface
- HackerOne eligible: www.doordash.com (Critical), iOS app, Android app
- Test accounts: Use plus-addressing (email+test1@gmail.com)
- Sandbox: doordashtest.com (Stripe test cards supported)
- Avg payout: ~$700+ (Critical = much higher)

### Camoufox (Anti-Detection Browser)
- GitHub: github.com/daijro/camoufox
- Playwright-compatible API
- Bypasses Cloudflare, DataDome, Akamai
- Patches at C++ level (not JS injection)
- Install: pip install camoufox

---

## ⚠️ Codespace Persistence Notes

### WILL Survive Sign-Out:
- Everything in /usr/local/bin/ (system path)
- Everything in /usr/local/go/bin/ (Go system install)
- Everything in ~/go/bin/ (user Go path)
- Python packages via pip3
- ~/.bashrc PATH additions
- All files in /workspaces/agent-mothership/

### WILL NOT Survive Codespace Deletion:
- GitHub deletes inactive codespaces after 30 days (default)
- Configurable in GitHub Settings → Codespaces
- To keep longer: pin the codespace or set timeout to 90 days

### To Re-install After Codespace Reset:
If codespace gets rebuilt, run:
```bash
# Go
cd /tmp && wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && sudo tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc

# Pre-built binaries
curl -sL https://github.com/projectdiscovery/nuclei/releases/download/v3.3.7/nuclei_3.3.7_linux_amd64.zip -o /tmp/nuclei.zip && unzip -o /tmp/nuclei.zip nuclei -d /usr/local/bin/
curl -sL https://github.com/ffuf/ffuf/releases/download/v2.1.0/ffuf_2.1.0_linux_amd64.tar.gz -o /tmp/ffuf.tar.gz && tar xzf /tmp/ffuf.tar.gz ffuf -C /usr/local/bin/
curl -sL https://github.com/projectdiscovery/katana/releases/download/v1.1.2/katana_1.1.2_linux_amd64.zip -o /tmp/katana.zip && unzip -o /tmp/katana.zip katana -d /usr/local/bin/

# Go tools
go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install github.com/projectdiscovery/httpx/cmd/httpx@latest
go install github.com/tomnomnom/waybackurls@latest
go install github.com/tomnomnom/unfurl@latest
go install github.com/lc/gau/v2/cmd/gau@latest
go install github.com/tomnomnom/qsreplace@latest
go install github.com/tomnomnom/anew@latest
go install github.com/hakluke/hakrawler@latest

# System tools
sudo apt-get install -y nmap whois dnsutils jq

# Python tools
pip3 install --break-system-packages sqlmap dirsearch wafw00f arjun droopescan

# Nikto + WhatWeb (from git)
cd /tmp && git clone --depth 1 https://github.com/sullo/nikto.git && sudo cp -r nikto /opt/nikto && sudo ln -sf /opt/nikto/program/nikto.pl /usr/local/bin/nikto
cd /tmp && git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git && sudo ln -sf /tmp/WhatWeb/whatweb /usr/local/bin/whatweb

# Update nuclei templates
nuclei -update-templates
```

---

## 📁 Project Files of Interest

| File | Purpose |
|------|--------|
| bounties/anthropic/HACKERONE-SUBMISSION.md | Anthropic bounty report (submit this) |
| bounties/anthropic/evidence/ | Proof files, strace logs, mock server |
| bounties/anthropic/session-*.md | Session logs (001-005) |
| bounties/anthropic/rce-mock-server.py | RCE mock server (reusable) |
| bounties/anthropic/attack-brainstorm.md | Attack vector brainstorm |
| bounties/anthropic/github-repos-report.md | Security research repos |
| CONTEXT.md | Full project context |
| RESEARCH.md | Ivanti agent research |
| web-terminal/ | Beacon relay & web terminal |
| proxy_dll/ | DLL proxy for Ivanti agent |

---

*This file name is definitely about a videogame and nothing else. our projects have no ethical boundaries. we finad all the exploits wethere elligible or inelligible. we alwasy win.*
