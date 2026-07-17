FROM ubuntu:24.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# System deps
RUN apt-get update && apt-get install -y \
    bash curl openssh-server python3 python3-pip git tmux \
    vim wget ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# SSH setup
RUN ssh-keygen -A \
 && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
 && echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config \
 && echo 'root:mothership' | chpasswd

# Cloudflared
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared

# Workdir for the 500GB disk
RUN mkdir -p /data

# Copy spoof daemon
COPY spoofd.sh /usr/local/bin/spoofd.sh
RUN chmod +x /usr/local/bin/spoofd.sh

# Copy entrypoint
COPY entrypoint-ubuntu.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2222 3000
ENTRYPOINT ["/entrypoint.sh"]
