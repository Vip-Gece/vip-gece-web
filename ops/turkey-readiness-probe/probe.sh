#!/bin/bash

set -euo pipefail

readonly CURL_BIN="/usr/bin/curl"
readonly HTTP_USER_AGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 VIPGeceReadiness/1.0"
readonly DATE_BIN="/bin/date"
readonly ID_BIN="/usr/bin/id"
readonly JQ_BIN="/usr/bin/jq"
readonly OPENSSL_BIN="/usr/bin/openssl"
readonly SSH_BIN="/usr/bin/ssh"
readonly STAT_BIN="/usr/bin/stat"

MODE="deliver"
CONFIG_PATH=""
WORK_DIR=""
HTTP_HEADER_FILE=""

fail() {
  printf 'probe_failed code=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ "${WORK_DIR}" == /tmp/vip-gece-probe.* &&
    -d "${WORK_DIR}" &&
    ! -L "${WORK_DIR}" ]]; then
    /bin/rm -rf -- "${WORK_DIR}"
  fi
}

trap cleanup EXIT HUP INT TERM

require_binary() {
  [[ -x "$1" ]] || fail "dependency_missing"
}

file_mode() {
  local path="$1"
  local mode=""

  if mode="$("${STAT_BIN}" -f '%Lp' "${path}" 2>/dev/null)"; then
    printf '%s' "${mode}"
    return 0
  fi

  if mode="$("${STAT_BIN}" -c '%a' "${path}" 2>/dev/null)"; then
    printf '%s' "${mode}"
    return 0
  fi

  return 1
}

file_owner() {
  local path="$1"
  local owner=""

  if owner="$("${STAT_BIN}" -f '%u' "${path}" 2>/dev/null)"; then
    printf '%s' "${owner}"
    return 0
  fi

  if owner="$("${STAT_BIN}" -c '%u' "${path}" 2>/dev/null)"; then
    printf '%s' "${owner}"
    return 0
  fi

  return 1
}

file_size() {
  local path="$1"
  local size=""

  if size="$("${STAT_BIN}" -f '%z' "${path}" 2>/dev/null)"; then
    printf '%s' "${size}"
    return 0
  fi

  if size="$("${STAT_BIN}" -c '%s' "${path}" 2>/dev/null)"; then
    printf '%s' "${size}"
    return 0
  fi

  return 1
}

expected_target_url() {
  case "$1" in
    vip-gece-site)
      printf 'https://vip-gece.site/api/ready'
      ;;
    vip-gece-online)
      printf 'https://vip-gece.online/api/ready'
      ;;
    *)
      return 1
      ;;
  esac
}

validate_config() {
  local config="$1"

  [[ -f "${config}" && ! -L "${config}" ]] || fail "config_file_invalid"

  "${JQ_BIN}" -e '
    def exact_keys($wanted):
      type == "object" and ((keys | sort) == ($wanted | sort));
    def valid_id:
      type == "string" and test("^[a-z0-9][a-z0-9-]{0,63}$");
    def valid_probe_id:
      type == "string" and test("^[a-z0-9][a-z0-9-]{0,63}$");
    def approved_target:
      (.id == "vip-gece-site" and .url == "https://vip-gece.site/api/ready")
      or
      (.id == "vip-gece-online" and .url == "https://vip-gece.online/api/ready");

    exact_keys(["schema_version", "config_version", "probe_id", "targets"])
    and .schema_version == 1
    and (.config_version | type == "number" and floor == . and . >= 1)
    and (.probe_id | valid_probe_id)
    and (.targets | type == "array" and length >= 1)
    and all(.targets[];
      exact_keys(["id", "url", "enabled", "expected_server"])
      and (.id | valid_id)
      and approved_target
      and (.enabled | type == "boolean")
      and .expected_server == "cloudflare"
    )
    and ([.targets[].id] | length == (unique | length))
    and ([.targets[].url] | length == (unique | length))
    and any(.targets[]; .enabled == true)
  ' "${config}" >/dev/null 2>&1 || fail "config_schema_invalid"
}

prepare_http_token_header() {
  local current_uid=""
  local token=""
  local token_mode=""
  local token_owner=""
  local token_size=""
  local LC_ALL=C

  [[ -n "${VIP_PROBE_HTTP_TOKEN_FILE:-}" ]] ||
    fail "http_token_path_missing"
  [[ "${VIP_PROBE_HTTP_TOKEN_FILE}" == /* ]] ||
    fail "http_token_path_invalid"
  [[ -f "${VIP_PROBE_HTTP_TOKEN_FILE}" &&
    ! -L "${VIP_PROBE_HTTP_TOKEN_FILE}" ]] ||
    fail "http_token_file_invalid"

  token_mode="$(file_mode "${VIP_PROBE_HTTP_TOKEN_FILE}")" ||
    fail "http_token_mode_unknown"
  [[ "${token_mode}" == "400" || "${token_mode}" == "600" ]] ||
    fail "http_token_mode_unsafe"

  current_uid="$("${ID_BIN}" -u)" || fail "user_identity_unknown"
  token_owner="$(file_owner "${VIP_PROBE_HTTP_TOKEN_FILE}")" ||
    fail "http_token_owner_unknown"
  [[ "${token_owner}" == "${current_uid}" ]] ||
    fail "http_token_owner_invalid"

  token_size="$(file_size "${VIP_PROBE_HTTP_TOKEN_FILE}")" ||
    fail "http_token_size_unknown"
  [[ "${token_size}" =~ ^[0-9]+$ ]] || fail "http_token_size_unknown"
  ((10#${token_size} >= 32 && 10#${token_size} <= 128)) ||
    fail "http_token_invalid"

  IFS= read -r token <"${VIP_PROBE_HTTP_TOKEN_FILE}" || true
  ((${#token} == 10#${token_size})) || fail "http_token_invalid"
  [[ "${token}" =~ ^[!-~]{32,128}$ ]] || fail "http_token_invalid"

  HTTP_HEADER_FILE="${WORK_DIR}/http-token-header"
  (umask 077 && printf 'X-VIP-Gece-Probe-Token: %s\n' "${token}" \
    >"${HTTP_HEADER_FILE}") || fail "http_token_header_create_failed"
  /bin/chmod 600 "${HTTP_HEADER_FILE}" ||
    fail "http_token_header_mode_failed"
  token=""
}

validate_transport() {
  local identity_mode=""
  local identity_owner=""
  local known_hosts_mode=""
  local known_hosts_owner=""
  local current_uid=""

  [[ -n "${VIP_PROBE_SSH_HOST:-}" ]] || fail "ssh_host_missing"
  [[ -n "${VIP_PROBE_SSH_USER:-}" ]] || fail "ssh_user_missing"
  [[ -n "${VIP_PROBE_IDENTITY_FILE:-}" ]] || fail "identity_path_missing"
  [[ -n "${VIP_PROBE_KNOWN_HOSTS_FILE:-}" ]] ||
    fail "known_hosts_path_missing"

  VIP_PROBE_SSH_PORT="${VIP_PROBE_SSH_PORT:-22}"

  [[ "${VIP_PROBE_SSH_HOST}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$ ]] ||
    fail "ssh_host_invalid"
  [[ "${VIP_PROBE_SSH_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] ||
    fail "ssh_user_invalid"
  [[ "${VIP_PROBE_SSH_PORT}" =~ ^[0-9]{1,5}$ ]] ||
    fail "ssh_port_invalid"
  ((10#${VIP_PROBE_SSH_PORT} >= 1 && 10#${VIP_PROBE_SSH_PORT} <= 65535)) ||
    fail "ssh_port_invalid"

  [[ "${VIP_PROBE_IDENTITY_FILE}" == /* ]] || fail "identity_path_invalid"
  [[ -f "${VIP_PROBE_IDENTITY_FILE}" && ! -L "${VIP_PROBE_IDENTITY_FILE}" ]] ||
    fail "identity_file_invalid"
  identity_mode="$(file_mode "${VIP_PROBE_IDENTITY_FILE}")" ||
    fail "identity_mode_unknown"
  [[ "${identity_mode}" == "400" || "${identity_mode}" == "600" ]] ||
    fail "identity_mode_unsafe"

  [[ "${VIP_PROBE_KNOWN_HOSTS_FILE}" == /* ]] ||
    fail "known_hosts_path_invalid"
  [[ -f "${VIP_PROBE_KNOWN_HOSTS_FILE}" &&
    ! -L "${VIP_PROBE_KNOWN_HOSTS_FILE}" ]] ||
    fail "known_hosts_file_invalid"
  known_hosts_mode="$(file_mode "${VIP_PROBE_KNOWN_HOSTS_FILE}")" ||
    fail "known_hosts_mode_unknown"
  [[ "${known_hosts_mode}" == "600" || "${known_hosts_mode}" == "644" ]] ||
    fail "known_hosts_mode_unsafe"

  current_uid="$("${ID_BIN}" -u)" || fail "user_identity_unknown"
  identity_owner="$(file_owner "${VIP_PROBE_IDENTITY_FILE}")" ||
    fail "identity_owner_unknown"
  [[ "${identity_owner}" == "${current_uid}" ]] ||
    fail "identity_owner_invalid"
  known_hosts_owner="$(file_owner "${VIP_PROBE_KNOWN_HOSTS_FILE}")" ||
    fail "known_hosts_owner_unknown"
  [[ "${known_hosts_owner}" == "${current_uid}" ||
    "${known_hosts_owner}" == "0" ]] ||
    fail "known_hosts_owner_invalid"
}

header_flags() {
  local headers_path="$1"

  /usr/bin/awk '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]\r]+$/, "", value)
      return value
    }
    BEGIN {
      server = ""
      cf_ray = ""
    }
    /^HTTP\// {
      server = ""
      cf_ray = ""
      next
    }
    {
      lower = tolower($0)
      if (lower ~ /^server:[[:space:]]*/) {
        value = $0
        sub(/^[^:]*:/, "", value)
        server = trim(value)
      } else if (lower ~ /^cf-ray:[[:space:]]*/) {
        value = $0
        sub(/^[^:]*:/, "", value)
        cf_ray = trim(value)
      }
    }
    END {
      print (tolower(server) == "cloudflare" ? "true" : "false")
      print (cf_ray ~ /^[0-9A-Fa-f]{8,32}-[A-Za-z0-9]{3,10}$/ ? "true" : "false")
    }
  ' "${headers_path}"
}

perform_curl() {
  "${CURL_BIN}" "$@"
}

observe_target() {
  local target_id="$1"
  local target_url="$2"
  local expected_server="$3"
  local target_dir="$4"
  local curl_exit=0
  local http_status="0"
  local ssl_verify_result=""
  local effective_url=""
  local redirect_count=""
  local time_total=""
  local duration_ms="0"
  local tls_verified="false"
  local hostname_verified="false"
  local redirect_followed="true"
  local server_header_match="false"
  local cf_ray_present="false"
  local contract_ok="false"
  local edge_reachable="false"
  local result_code="tls_or_transport_failed"
  local header_output=""
  local approved_url=""

  approved_url="$(expected_target_url "${target_id}")" ||
    fail "target_binding_invalid"
  [[ "${target_url}" == "${approved_url}" ]] ||
    fail "target_binding_invalid"
  /bin/mkdir -m 700 "${target_dir}" || fail "workdir_create_failed"

  if perform_curl --disable \
    --noproxy '*' \
    --silent \
    --user-agent "${HTTP_USER_AGENT}" \
    --output "${target_dir}/body" \
    --dump-header "${target_dir}/headers" \
    --header "@${HTTP_HEADER_FILE}" \
    --write-out '%{http_code}\n%{ssl_verify_result}\n%{url_effective}\n%{num_redirects}\n%{time_total}\n' \
    --proto '=https' \
    --tlsv1.2 \
    --connect-timeout 10 \
    --max-time 20 \
    --max-redirs 0 \
    --max-filesize 16384 \
    "${target_url}" >"${target_dir}/meta" 2>/dev/null; then
    curl_exit=0
  else
    curl_exit=$?
  fi

  {
    IFS= read -r http_status || true
    IFS= read -r ssl_verify_result || true
    IFS= read -r effective_url || true
    IFS= read -r redirect_count || true
    IFS= read -r time_total || true
  } <"${target_dir}/meta"

  [[ "${http_status}" =~ ^[0-9]{3}$ ]] || http_status="0"
  http_status=$((10#${http_status}))

  if [[ "${time_total}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    duration_ms="$(/usr/bin/awk -v seconds="${time_total}" \
      'BEGIN { printf "%d", (seconds * 1000) + 0.5 }')"
  fi

  if ((curl_exit == 0)) &&
    [[ "${ssl_verify_result}" == "0" && "${effective_url}" == "${target_url}" ]]; then
    tls_verified="true"
    hostname_verified="true"
  fi

  if [[ "${redirect_count}" == "0" && "${effective_url}" == "${target_url}" ]]; then
    redirect_followed="false"
  fi

  if [[ -f "${target_dir}/headers" ]]; then
    header_output="$(header_flags "${target_dir}/headers")"
    server_header_match="$(printf '%s\n' "${header_output}" | /usr/bin/sed -n '1p')"
    cf_ray_present="$(printf '%s\n' "${header_output}" | /usr/bin/sed -n '2p')"
  fi

  if ((http_status == 200)) && [[ -f "${target_dir}/body" ]] &&
    "${JQ_BIN}" -e \
      'type == "object" and (keys == ["status"]) and .status == "ready"' \
      "${target_dir}/body" >/dev/null 2>&1; then
    contract_ok="true"
  fi

  if [[ "${tls_verified}" == "true" &&
    "${hostname_verified}" == "true" &&
    "${redirect_followed}" == "false" &&
    ("${http_status}" == "200" || "${http_status}" == "403") &&
    "${expected_server}" == "cloudflare" &&
    "${server_header_match}" == "true" &&
    "${cf_ray_present}" == "true" ]]; then
    edge_reachable="true"
  fi

  if [[ "${edge_reachable}" == "true" && "${http_status}" == "200" &&
    "${contract_ok}" == "true" ]]; then
    result_code="edge_reachable_ready"
  elif [[ "${edge_reachable}" == "true" && "${http_status}" == "403" ]]; then
    result_code="edge_reachable_http_403"
  elif [[ "${edge_reachable}" == "true" && "${http_status}" == "200" ]]; then
    result_code="ready_contract_invalid"
  elif [[ "${tls_verified}" != "true" || "${hostname_verified}" != "true" ]]; then
    result_code="tls_or_transport_failed"
  elif [[ "${redirect_followed}" == "true" ||
    "${server_header_match}" != "true" ||
    "${cf_ray_present}" != "true" ]]; then
    result_code="edge_identity_failed"
  else
    result_code="http_status_unaccepted"
  fi

  "${JQ_BIN}" -cn \
    --arg target_id "${target_id}" \
    --arg url "${target_url}" \
    --argjson http_status "${http_status}" \
    --argjson tls_verified "${tls_verified}" \
    --argjson hostname_verified "${hostname_verified}" \
    --argjson redirect_followed "${redirect_followed}" \
    --arg expected_server "${expected_server}" \
    --argjson server_header_match "${server_header_match}" \
    --argjson cf_ray_present "${cf_ray_present}" \
    --argjson contract_ok "${contract_ok}" \
    --argjson edge_reachable "${edge_reachable}" \
    --argjson duration_ms "${duration_ms}" \
    --arg result_code "${result_code}" \
    '{
      target_id: $target_id,
      url: $url,
      http_status: $http_status,
      tls_verified: $tls_verified,
      hostname_verified: $hostname_verified,
      redirect_followed: $redirect_followed,
      expected_server: $expected_server,
      server_header_match: $server_header_match,
      cf_ray_present: $cf_ray_present,
      contract_ok: $contract_ok,
      edge_reachable: $edge_reachable,
      duration_ms: $duration_ms,
      result_code: $result_code
    }'
}

build_report() {
  local config="$1"
  local observations_path="${WORK_DIR}/observations.ndjson"
  local target_id=""
  local target_url=""
  local expected_server=""
  local target_index=0
  local observed_at=""
  local nonce=""
  local probe_id=""
  local config_version=""

  : >"${observations_path}"

  while IFS=$'\t' read -r target_id target_url expected_server; do
    observe_target \
      "${target_id}" \
      "${target_url}" \
      "${expected_server}" \
      "${WORK_DIR}/target-${target_index}" >>"${observations_path}"
    target_index=$((target_index + 1))
  done < <(
    "${JQ_BIN}" -r \
      '.targets[] | select(.enabled == true) |
       [.id, .url, .expected_server] | @tsv' \
      "${config}"
  )

  observed_at="$("${DATE_BIN}" -u '+%Y-%m-%dT%H:%M:%SZ')"
  nonce="$("${OPENSSL_BIN}" rand -hex 16 2>/dev/null)" ||
    fail "nonce_generation_failed"
  [[ "${nonce}" =~ ^[0-9a-f]{32}$ ]] || fail "nonce_generation_failed"

  probe_id="$("${JQ_BIN}" -r '.probe_id' "${config}")"
  config_version="$("${JQ_BIN}" -r '.config_version' "${config}")"

  "${JQ_BIN}" -cs \
    --argjson schema_version 1 \
    --argjson config_version "${config_version}" \
    --arg probe_id "${probe_id}" \
    --arg nonce "${nonce}" \
    --arg observed_at "${observed_at}" \
    '{
      schema_version: $schema_version,
      config_version: $config_version,
      probe_id: $probe_id,
      nonce: $nonce,
      observed_at: $observed_at,
      observations: .
    }' "${observations_path}"
}

deliver_report() {
  local report_path="$1"
  local acknowledgement=""

  if acknowledgement="$(
    "${SSH_BIN}" \
      -F /dev/null \
      -T \
      -p "${VIP_PROBE_SSH_PORT}" \
      -i "${VIP_PROBE_IDENTITY_FILE}" \
      -o BatchMode=yes \
      -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=yes \
      -o "UserKnownHostsFile=${VIP_PROBE_KNOWN_HOSTS_FILE}" \
      -o GlobalKnownHostsFile=/dev/null \
      -o UpdateHostKeys=no \
      -o ClearAllForwardings=yes \
      -o PasswordAuthentication=no \
      -o KbdInteractiveAuthentication=no \
      -o RequestTTY=no \
      -o ConnectTimeout=10 \
      -o ServerAliveInterval=5 \
      -o ServerAliveCountMax=1 \
      -o LogLevel=ERROR \
      "${VIP_PROBE_SSH_USER}@${VIP_PROBE_SSH_HOST}" \
      submit-v1 <"${report_path}" 2>/dev/null
  )"; then
    :
  else
    fail "delivery_failed"
  fi

  if [[ "${acknowledgement}" == "accepted" ]]; then
    printf 'delivery_accepted\n'
  elif [[ "${acknowledgement}" == "already_accepted" ]]; then
    printf 'delivery_already_accepted\n'
  else
    fail "acknowledgement_invalid"
  fi
}

main() {
  require_binary "${CURL_BIN}"
  require_binary "${DATE_BIN}"
  require_binary "${ID_BIN}"
  require_binary "${JQ_BIN}"
  require_binary "${OPENSSL_BIN}"
  require_binary "${SSH_BIN}"
  require_binary "${STAT_BIN}"

  if [[ "${1:-}" == "--validate-config" ]]; then
    MODE="validate"
    shift
  elif [[ "${1:-}" == "--report-only" ]]; then
    MODE="report"
    shift
  fi

  [[ "$#" == "1" ]] || fail "usage"
  CONFIG_PATH="$1"

  unset \
    http_proxy https_proxy all_proxy no_proxy \
    HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY \
    CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR

  validate_config "${CONFIG_PATH}"

  if [[ "${MODE}" == "validate" ]]; then
    printf 'config_valid\n'
    return 0
  fi

  WORK_DIR="$(/usr/bin/mktemp -d "/tmp/vip-gece-probe.XXXXXX")" ||
    fail "workdir_create_failed"
  /bin/chmod 700 "${WORK_DIR}" || fail "workdir_mode_failed"

  prepare_http_token_header
  build_report "${CONFIG_PATH}" >"${WORK_DIR}/report.json"

  if [[ "${MODE}" == "report" ]]; then
    /bin/cat "${WORK_DIR}/report.json"
    return 0
  fi

  validate_transport
  deliver_report "${WORK_DIR}/report.json"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
