'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const PROJECT_DIR = path.resolve(__dirname, '..');
const INGEST_PATH = path.join(PROJECT_DIR, 'ingest.js');
const PROBE_PATH = path.join(PROJECT_DIR, 'probe.sh');

function utcSecond(offsetSeconds = 0) {
  const milliseconds =
    Math.floor((Date.now() + offsetSeconds * 1000) / 1000) * 1000;
  return new Date(milliseconds).toISOString().replace('.000Z', 'Z');
}

function nonce(character = 'a') {
  return character.repeat(32);
}

function targetConfig() {
  return {
    schema_version: 1,
    config_version: 1,
    probe_id: 'tr-mac-01',
    targets: [
      {
        id: 'vip-gece-site',
        url: 'https://vip-gece.site/api/ready',
        enabled: true,
        expected_server: 'cloudflare',
      },
      {
        id: 'vip-gece-online',
        url: 'https://vip-gece.online/api/ready',
        enabled: false,
        expected_server: 'cloudflare',
      },
    ],
  };
}

function edgeObservation(overrides = {}) {
  const base = {
    target_id: 'vip-gece-site',
    url: 'https://vip-gece.site/api/ready',
    http_status: 403,
    tls_verified: true,
    hostname_verified: true,
    redirect_followed: false,
    expected_server: 'cloudflare',
    server_header_match: true,
    cf_ray_present: true,
    contract_ok: false,
    edge_reachable: true,
    duration_ms: 125,
    result_code: 'edge_reachable_http_403',
  };
  return { ...base, ...overrides };
}

function report(overrides = {}) {
  const base = {
    schema_version: 1,
    config_version: 1,
    probe_id: 'tr-mac-01',
    nonce: nonce(),
    observed_at: utcSecond(),
    observations: [edgeObservation()],
  };
  return { ...base, ...overrides };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-probe-test-'));
  const configPath = path.join(root, 'targets.json');
  const spoolDirectory = path.join(root, 'spool');
  const spoolPath = path.join(spoolDirectory, 'latest.json');
  fs.writeFileSync(configPath, `${JSON.stringify(targetConfig())}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(configPath, 0o600);
  fs.mkdirSync(spoolDirectory, { mode: 0o750 });
  fs.chmodSync(spoolDirectory, 0o750);

  return {
    root,
    configPath,
    spoolDirectory,
    spoolPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function ingest(fx, payload) {
  return spawnSync(
    process.execPath,
    [
      INGEST_PATH,
      '--probe-id=tr-mac-01',
      `--config=${fx.configPath}`,
      `--spool=${fx.spoolPath}`,
      `--config-owner-uid=${process.getuid()}`,
    ],
    {
      input: `${JSON.stringify(payload)}\n`,
      encoding: 'utf8',
      env: {
        ...process.env,
        SSH_ORIGINAL_COMMAND: 'submit-v1',
      },
    },
  );
}

function expectRejected(result, code) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `rejected code=${code}\n`);
}

function probe(fx, args, env = {}) {
  return spawnSync('/bin/bash', [PROBE_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function writeToken(fx, value, mode = 0o600) {
  const tokenPath = path.join(fx.root, 'probe-http-token');
  fs.writeFileSync(tokenPath, value, { mode });
  fs.chmodSync(tokenPath, mode);
  return tokenPath;
}

test('accepts a Cloudflare 403 only as Türkiye edge evidence', () => {
  const fx = fixture();
  try {
    const result = ingest(fx, report());
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'accepted\n');
    assert.equal(result.stderr, '');

    const snapshot = JSON.parse(fs.readFileSync(fx.spoolPath, 'utf8'));
    assert.equal(snapshot.observations.length, 1);
    assert.equal(snapshot.observations[0].http_status, 403);
    assert.equal(snapshot.observations[0].edge_reachable, true);
    assert.equal(snapshot.observations[0].contract_ok, false);
    assert.equal('healthy' in snapshot.observations[0], false);
    assert.match(snapshot.received_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(snapshot.payload_sha256, /^[0-9a-f]{64}$/);
    assert.equal(fs.statSync(fx.spoolPath).mode & 0o777, 0o640);
  } finally {
    fx.cleanup();
  }
});

test('accepts a 200 only when the exact readiness contract was observed', () => {
  const fx = fixture();
  try {
    const payload = report({
      observations: [
        edgeObservation({
          http_status: 200,
          contract_ok: true,
          result_code: 'edge_reachable_ready',
        }),
      ],
    });
    const result = ingest(fx, payload);
    assert.equal(result.status, 0);
    const snapshot = JSON.parse(fs.readFileSync(fx.spoolPath, 'utf8'));
    assert.equal(snapshot.observations[0].edge_reachable, true);
    assert.equal(snapshot.observations[0].contract_ok, true);
  } finally {
    fx.cleanup();
  }
});

test('strict schema and allowlist binding reject inconsistent evidence', async (t) => {
  const cases = [
    {
      name: 'client edge boolean cannot contradict evidence',
      mutate(payload) {
        payload.observations[0].edge_reachable = false;
      },
      code: 'edge_evidence_inconsistent',
    },
    {
      name: 'unknown health field is rejected',
      mutate(payload) {
        payload.observations[0].healthy = true;
      },
      code: 'observation_invalid',
    },
    {
      name: 'disabled target cannot replace enabled target',
      mutate(payload) {
        payload.observations = [
          edgeObservation({
            target_id: 'vip-gece-online',
            url: 'https://vip-gece.online/api/ready',
          }),
        ];
      },
      code: 'target_set_invalid',
    },
    {
      name: 'URL must match the server allowlist exactly',
      mutate(payload) {
        payload.observations[0].url = 'https://vip-gece.site/health';
      },
      code: 'target_binding_invalid',
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const fx = fixture();
      try {
        const payload = report();
        item.mutate(payload);
        expectRejected(ingest(fx, payload), item.code);
        assert.equal(fs.existsSync(fx.spoolPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('rejects stale and implausibly future client timestamps', async (t) => {
  await t.test('stale', () => {
    const fx = fixture();
    try {
      expectRejected(
        ingest(fx, report({ observed_at: utcSecond(-180) })),
        'report_stale',
      );
    } finally {
      fx.cleanup();
    }
  });

  await t.test('future', () => {
    const fx = fixture();
    try {
      expectRejected(
        ingest(fx, report({ observed_at: utcSecond(60) })),
        'report_from_future',
      );
    } finally {
      fx.cleanup();
    }
  });
});

test('identical retries are idempotent and replay/order checks are strict', () => {
  const fx = fixture();
  try {
    const first = report({ observed_at: utcSecond(-1) });
    assert.equal(ingest(fx, first).stdout, 'accepted\n');
    const originalBytes = fs.readFileSync(fx.spoolPath);

    const retry = ingest(fx, first);
    assert.equal(retry.status, 0);
    assert.equal(retry.stdout, 'already_accepted\n');
    assert.deepEqual(fs.readFileSync(fx.spoolPath), originalBytes);

    const conflict = structuredClone(first);
    conflict.observations[0].duration_ms += 1;
    expectRejected(ingest(fx, conflict), 'replay_conflict');
    assert.deepEqual(fs.readFileSync(fx.spoolPath), originalBytes);

    const older = report({
      nonce: nonce('b'),
      observed_at: new Date(Date.parse(first.observed_at) - 1000)
        .toISOString()
        .replace('.000Z', 'Z'),
    });
    expectRejected(ingest(fx, older), 'out_of_order');
    assert.deepEqual(fs.readFileSync(fx.spoolPath), originalBytes);
  } finally {
    fx.cleanup();
  }
});

test('a symlink can never be used as the spool snapshot', () => {
  const fx = fixture();
  try {
    const victimPath = path.join(fx.root, 'victim.json');
    fs.writeFileSync(victimPath, 'unchanged\n', { mode: 0o600 });
    fs.symlinkSync(victimPath, fx.spoolPath);

    expectRejected(ingest(fx, report()), 'spool_symlink');
    assert.equal(fs.readFileSync(victimPath, 'utf8'), 'unchanged\n');
    assert.equal(fs.lstatSync(fx.spoolPath).isSymbolicLink(), true);
  } finally {
    fx.cleanup();
  }
});

test('probe shell parses and validates the shared strict config', () => {
  const fx = fixture();
  try {
    const syntax = spawnSync('/bin/bash', ['-n', PROBE_PATH], {
      encoding: 'utf8',
    });
    assert.equal(syntax.status, 0, syntax.stderr);

    const validation = spawnSync(
      '/bin/bash',
      [PROBE_PATH, '--validate-config', fx.configPath],
      { encoding: 'utf8' },
    );
    assert.equal(validation.status, 0, validation.stderr);
    assert.equal(validation.stdout, 'config_valid\n');
  } finally {
    fx.cleanup();
  }
});

test('probe and ingest reject target IDs or URLs outside the fixed VIP allowlist', async (t) => {
  for (const [name, mutate] of [
    [
      'unknown target id',
      (config) => {
        config.targets[1].id = 'other-target';
      },
    ],
    [
      'arbitrary HTTPS readiness URL',
      (config) => {
        config.targets[1].url = 'https://example.invalid/api/ready';
      },
    ],
  ]) {
    await t.test(name, () => {
      const fx = fixture();
      try {
        const config = targetConfig();
        mutate(config);
        fs.writeFileSync(fx.configPath, `${JSON.stringify(config)}\n`, {
          mode: 0o600,
        });
        fs.chmodSync(fx.configPath, 0o600);

        const validation = probe(fx, ['--validate-config', fx.configPath]);
        assert.notEqual(validation.status, 0);
        assert.equal(validation.stderr, 'probe_failed code=config_schema_invalid\n');
        expectRejected(ingest(fx, report()), 'config_schema_invalid');
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('the curl sink rechecks the target binding before reading the token header', () => {
  const fx = fixture();
  try {
    const markerPath = path.join(fx.root, 'curl-called');
    const harness = String.raw`
      source "__DOLLAR__1"
      perform_curl() {
        : >"__DOLLAR__2"
        return 99
      }
      WORK_DIR="__DOLLAR__3"
      HTTP_HEADER_FILE="__DOLLAR__3/header"
      observe_target \
        vip-gece-site \
        https://example.invalid/api/ready \
        cloudflare \
        "__DOLLAR__3/target"
    `.replaceAll('__DOLLAR__', '$');
    const result = spawnSync(
      '/bin/bash',
      ['-c', harness, 'probe-test', PROBE_PATH, markerPath, fx.root],
      { encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, 'probe_failed code=target_binding_invalid\n');
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fx.cleanup();
  }
});

test('config-only validation remains independent of the HTTP token', () => {
  const fx = fixture();
  try {
    const validation = probe(fx, ['--validate-config', fx.configPath], {
      VIP_PROBE_HTTP_TOKEN_FILE: '',
    });
    assert.equal(validation.status, 0, validation.stderr);
    assert.equal(validation.stdout, 'config_valid\n');
  } finally {
    fx.cleanup();
  }
});

test('network observation fails closed when the HTTP token is absent or unsafe', async (t) => {
  const cases = [
    {
      name: 'missing token path',
      env: { VIP_PROBE_HTTP_TOKEN_FILE: '' },
      code: 'http_token_path_missing',
    },
    {
      name: 'relative token path',
      env: { VIP_PROBE_HTTP_TOKEN_FILE: 'probe-http-token' },
      code: 'http_token_path_invalid',
    },
    {
      name: 'symlink token file',
      setup(fx) {
        const targetPath = writeToken(fx, 'a'.repeat(32));
        const tokenPath = path.join(fx.root, 'probe-http-token-link');
        fs.symlinkSync(targetPath, tokenPath);
        return tokenPath;
      },
      code: 'http_token_file_invalid',
    },
    {
      name: 'group-readable token file',
      setup(fx) {
        return writeToken(fx, 'a'.repeat(32), 0o640);
      },
      code: 'http_token_mode_unsafe',
    },
    {
      name: 'short token',
      setup(fx) {
        return writeToken(fx, 'a'.repeat(31));
      },
      code: 'http_token_invalid',
    },
    {
      name: 'long token',
      setup(fx) {
        return writeToken(fx, 'a'.repeat(129));
      },
      code: 'http_token_invalid',
    },
    {
      name: 'token with whitespace',
      setup(fx) {
        return writeToken(fx, `${'a'.repeat(31)} `);
      },
      code: 'http_token_invalid',
    },
    {
      name: 'token with trailing newline',
      setup(fx) {
        return writeToken(fx, `${'a'.repeat(32)}\n`);
      },
      code: 'http_token_invalid',
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const fx = fixture();
      try {
        const tokenPath = item.setup?.(fx);
        const result = probe(fx, ['--report-only', fx.configPath], {
          ...item.env,
          ...(tokenPath ? { VIP_PROBE_HTTP_TOKEN_FILE: tokenPath } : {}),
        });
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `probe_failed code=${item.code}\n`);
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('probe sends a valid token through a private curl header file only', async (t) => {
  for (const [mode, length] of [
    [0o400, 32],
    [0o600, 128],
  ]) {
    await t.test(`accepts mode ${mode.toString(8)}`, () => {
      const fx = fixture();
      try {
        const tokenPath = writeToken(fx, 'v'.repeat(length), mode);
        const harness = String.raw`
          source "__DOLLAR__1"
          perform_curl() {
            local argument=""
            local body_path=""
            local expected=""
            local header_argument=""
            local header_path=""
            local headers_path=""
            local target_url=""
            local user_agent=""

            expected="__DOLLAR__(<"__DOLLAR__{VIP_PROBE_HTTP_TOKEN_FILE}")"
            for argument in "__DOLLAR__@"; do
              [[ "__DOLLAR__{argument}" != *"__DOLLAR__{expected}"* ]] ||
                return 91
            done

            while ((__DOLLAR__# > 0)); do
              case "__DOLLAR__1" in
                --output)
                  body_path="__DOLLAR__2"
                  shift 2
                  ;;
                --dump-header)
                  headers_path="__DOLLAR__2"
                  shift 2
                  ;;
                --header)
                  header_argument="__DOLLAR__2"
                  shift 2
                  ;;
                --user-agent)
                  user_agent="__DOLLAR__2"
                  shift 2
                  ;;
                --write-out)
                  shift 2
                  ;;
                -*)
                  shift
                  ;;
                *)
                  target_url="__DOLLAR__1"
                  shift
                  ;;
              esac
            done

            [[ "__DOLLAR__{header_argument}" == @/* ]] || return 92
            header_path="__DOLLAR__{header_argument#@}"
            [[ -f "__DOLLAR__{header_path}" &&
              ! -L "__DOLLAR__{header_path}" ]] || return 93
            [[ "__DOLLAR__(file_mode "__DOLLAR__{header_path}")" == "600" ]] ||
              return 94
            IFS= read -r argument <"__DOLLAR__{header_path}" || return 95
            [[ "__DOLLAR__{argument}" == "X-VIP-Gece-Probe-Token: __DOLLAR__{expected}" ]] ||
              return 96
            [[ "__DOLLAR__{HTTP_USER_AGENT}" == "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 VIPGeceReadiness/1.0" ]] ||
              return 97
            [[ "__DOLLAR__{user_agent}" == "__DOLLAR__{HTTP_USER_AGENT}" ]] ||
              return 98

            printf '{"status":"ready"}' >"__DOLLAR__{body_path}"
            printf 'HTTP/2 200\r\nServer: cloudflare\r\nCF-Ray: 12345678-IST\r\n\r\n' \
              >"__DOLLAR__{headers_path}"
            printf '200\n0\n%s\n0\n0.125\n' "__DOLLAR__{target_url}"
          }
          main --report-only "__DOLLAR__2"
        `.replaceAll('__DOLLAR__', '$');
        const result = spawnSync(
          '/bin/bash',
          ['-c', harness, 'probe-test', PROBE_PATH, fx.configPath],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              VIP_PROBE_HTTP_TOKEN_FILE: tokenPath,
            },
          },
        );

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout.includes('v'.repeat(length)), false);
        const output = JSON.parse(result.stdout);
        assert.equal(output.observations[0].http_status, 200);
        assert.equal(output.observations[0].contract_ok, true);
        assert.equal(output.observations[0].edge_reachable, true);
      } finally {
        fx.cleanup();
      }
    });
  }
});
