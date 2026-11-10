FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Herramientas para el cortafuegos y utilidades básicas (git y node ya vienen en la imagen).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      iptables ipset iproute2 dnsutils curl jq sudo python3 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# El usuario "node" solo puede ejecutar como root el script del cortafuegos, nada más.
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod 0755 /usr/local/bin/init-firewall.sh \
 && echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall \
 && chmod 0440 /etc/sudoers.d/node-firewall

USER node
