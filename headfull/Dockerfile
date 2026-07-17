FROM ubuntu:24.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# System deps + ttyd for web terminal
RUN apt-get update && apt-get install -y \
    bash curl openssh-server python3 python3-pip git tmux \
    vim wget ca-certificates nodejs npm ttyd \
    && rm -rf /var/lib/apt/lists/*

# Auto-start ttyd on port 7681 (no login)
RUN echo '#!/bin/bash\nttyd -p 7681 -W bash' > /usr/local/bin/start-webterm.sh \
 && chmod +x /usr/local/bin/start-webterm.sh

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

EXPOSE 2222 3000 7681
ENTRYPOINT ["/entrypoint.sh"]
