FROM alpine:latest

# ── System deps ──────────────────────────────────────────────────
RUN apk add --no-cache \
    bash curl openssh-server shadow sudo \
    python3 py3-pip git tmux

# ── SSH setup ────────────────────────────────────────────────────
RUN ssh-keygen -A \
 && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
 && echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config \
 && echo 'root:mothership' | chpasswd

# ── Cloudflared ──────────────────────────────────────────────────
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared

# ── freebuff (AI agent) ──────────────────────────────────────────
# Copy from host during build via docker cp or bind mount
# For now, we'll mount it at runtime

# ── Spoof daemon ─────────────────────────────────────────────────
COPY spoofd.sh /usr/local/bin/spoofd.sh
RUN chmod +x /usr/local/bin/spoofd.sh

# ── Entrypoint script ────────────────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2222 3000

ENTRYPOINT ["/entrypoint.sh"]
