#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ "${VIP_GECE_FIDO_APPLY:-}" != "I_UNDERSTAND_LOCKOUT_RISK" ]]; then
  echo "Refusing to apply without VIP_GECE_FIDO_APPLY=I_UNDERSTAND_LOCKOUT_RISK." >&2
  echo "Keep a working Hetzner console or an already-open root SSH session before enabling this." >&2
  exit 1
fi

if [[ ! -s /etc/security/u2f_keys ]]; then
  echo "/etc/security/u2f_keys is missing or empty. Enroll with pamu2fcfg first." >&2
  exit 1
fi

install -D -m 0644 "$(dirname "$0")/sshd-fido-u2f-hardening.conf" /etc/ssh/sshd_config.d/99-vip-gece-fido-u2f.conf
install -D -m 0644 "$(dirname "$0")/pam-u2f-sshd.example" /etc/pam.d/sshd
sshd -t
systemctl reload ssh

echo "FIDO U2F SSH policy applied. Test a second SSH login before closing the current session."
