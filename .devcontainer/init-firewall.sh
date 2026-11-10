#!/bin/bash
# Cortafuegos de salida: el contenedor solo puede hablar con los dominios de ALLOWED_DOMAINS.
# Todo lo demás se rechaza (por eso Claude no puede enviar tu código o datos a otro sitio).
# Se ejecuta como root vía sudo en cada arranque (postStartCommand).
set -euo pipefail
IFS=$'\n\t'

# Dominios que Claude Code necesita (lista oficial: code.claude.com/docs/en/network-config)
# y los de la extensión de VS Code. Quita o añade líneas según necesites.
ALLOWED_DOMAINS=(
  api.anthropic.com            # modelo
  claude.ai                    # inicio de sesión
  claude.com                   # inicio de sesión (redirige a claude.ai)
  platform.claude.com          # tokens OAuth
  downloads.claude.ai          # actualizaciones
  registry.npmjs.org           # npm (instalar paquetes del proyecto)
  marketplace.visualstudio.com # extensiones de VS Code
  vscode.blob.core.windows.net
  update.code.visualstudio.com
  main.vscode-cdn.net
  github.com                   # git fetch/clone (el push lo haces tú desde GitHub Desktop)
)

# Telemetría opcional de Claude Code: bloqueada a propósito (no está en la lista).

for bin in iptables ipset getent curl; do
  command -v "$bin" >/dev/null || { echo "ERROR: falta $bin"; exit 1; }
done

# 1) Guardar lo que Docker ya tenía para DNS interno y limpiar reglas anteriores.
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)
iptables -F; iptables -X
iptables -t nat -F; iptables -t nat -X
iptables -t mangle -F; iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true
if [ -n "$DOCKER_DNS_RULES" ]; then
  iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
  iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
  echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
fi

# 2) Siempre permitido: DNS, loopback.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT  -p tcp --sport 53 -j ACCEPT
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# 3) Lista de IPs permitidas.
ipset create allowed-domains hash:net

# GitHub publica sus rangos de IP.
if gh_meta=$(curl -fsS --max-time 15 https://api.github.com/meta 2>/dev/null); then
  while read -r cidr; do
    [[ "$cidr" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]] && ipset add -exist allowed-domains "$cidr"
  done < <(echo "$gh_meta" | jq -r '(.web + .api + .git)[]' 2>/dev/null | sort -u)
else
  echo "AVISO: no pude leer los rangos de GitHub; se resolverá github.com por DNS."
fi

for d in "${ALLOWED_DOMAINS[@]}"; do
  d=${d%%#*}; d=${d// /}
  [ -z "$d" ] && continue
  [[ "$d" == \** ]] && continue          # comodines: no se pueden resolver; usa dominios concretos
  ips=$(getent ahostsv4 "$d" | awk '{print $1}' | sort -u || true)
  if [ -z "$ips" ]; then echo "AVISO: no resuelvo $d"; continue; fi
  while read -r ip; do ipset add -exist allowed-domains "$ip"; done <<<"$ips"
done

# 4) Política: lo establecido sigue, salida solo a la lista, el resto se rechaza.
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# 5) Comprobación: example.com debe estar bloqueado y la API de Anthropic accesible.
if curl -sS --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "ERROR: example.com es accesible; el cortafuegos no funciona."; exit 1
fi
if ! curl -sS --max-time 10 -o /dev/null https://api.anthropic.com 2>/dev/null; then
  echo "AVISO: api.anthropic.com no responde (¿sin internet?). Claude no podrá conectar."
fi
echo "Cortafuegos activo: solo salen conexiones a la lista permitida."
