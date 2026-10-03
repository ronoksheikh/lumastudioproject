#!/usr/bin/env bash
# Egress blocklist for agent commands: processes running as a project user (uid range below) may not open
# connections to private networks, link-local addresses or cloud metadata endpoints. The api itself (root)
# is not affected, nor is loopback (the renderer talks to its own local server).
# Needs CAP_NET_ADMIN (compose: cap_add: [NET_ADMIN]). Without it the script says so and exits 0 - the rest of
# the isolation (per-project uid, bubblewrap, path confinement) still applies.
set -u

BASE="${PROJECT_UID_BASE:-100000}"
RANGE="${BASE}-$((BASE + 1000000))"
CHAIN=LUMA_EGRESS
V4=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 192.0.0.0/24 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4)
V6=(fc00::/7 fe80::/10 ff00::/8)

apply() {
  local ipt="$1"; shift
  local cidrs=("$@")
  "$ipt" -N "$CHAIN" 2>/dev/null || "$ipt" -F "$CHAIN"
  # name resolution keeps working even when the resolver has a private address
  "$ipt" -A "$CHAIN" -p udp --dport 53 -j RETURN
  "$ipt" -A "$CHAIN" -p tcp --dport 53 -j RETURN
  for c in "${cidrs[@]}"; do "$ipt" -A "$CHAIN" -d "$c" -j REJECT; done
  "$ipt" -C OUTPUT -m owner --uid-owner "$RANGE" -j "$CHAIN" 2>/dev/null || "$ipt" -I OUTPUT 1 -m owner --uid-owner "$RANGE" -j "$CHAIN"
}

if ! iptables -L OUTPUT -n >/dev/null 2>&1; then
  echo "[luma] egress blocklist NOT applied: no CAP_NET_ADMIN (add cap_add: [NET_ADMIN] to the service)" >&2
  exit 0
fi
apply iptables "${V4[@]}" && echo "[luma] egress blocklist active for uids ${RANGE} (IPv4)"
if ip6tables -L OUTPUT -n >/dev/null 2>&1; then apply ip6tables "${V6[@]}" && echo "[luma] egress blocklist active for uids ${RANGE} (IPv6)"; fi
exit 0
