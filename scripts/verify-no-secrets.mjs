import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const maximumTextBytes = 2 * 1024 * 1024;
const allowedTrackedEnvironmentFiles = new Set(['.env.example']);
const forbiddenFileName = /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:key|pem|p12|pfx|jks|keystore))$/iu;
const placeholder = /(?:example|fixture|local|placeholder|synthetic|not[-_ ]for[-_ ]production)/iu;

const rules = [
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  {
    name: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu,
  },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu },
  { name: 'npm access token', pattern: /\bnpm_[A-Za-z0-9]{36,}\b/gu },
  { name: 'OpenAI service key', pattern: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/gu },
  { name: 'SendGrid key', pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\b/gu },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu },
  {
    name: 'Stripe secret key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/gu,
  },
  { name: 'Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{24,}\b/gu },
  {
    name: 'PEM private key',
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
  },
  {
    name: 'Credentialed PostgreSQL URL',
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@[^\s'"`]+/gu,
    allowPlaceholder: true,
  },
];

function repositoryFiles() {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return listed
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function lineNumber(text, index) {
  let lines = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) lines += 1;
  }
  return lines;
}

const findings = [];
let scanned = 0;

for (const file of repositoryFiles()) {
  const normalized = file.replaceAll('\\', '/');
  if (forbiddenFileName.test(normalized) && !allowedTrackedEnvironmentFiles.has(normalized)) {
    findings.push({ file: normalized, line: 1, rule: 'forbidden secret-bearing filename' });
  }
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue;
  }
  if (bytes.byteLength > maximumTextBytes || bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  scanned += 1;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.allowPlaceholder === true && placeholder.test(match[0])) continue;
      findings.push({
        file: normalized,
        line: lineNumber(text, match.index ?? 0),
        rule: rule.name,
      });
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    'Potential secret material found (matched values are intentionally hidden):\n',
  );
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file}:${finding.line} — ${finding.rule}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `High-confidence secret scan passed across ${String(scanned)} text files; this is not managed-KMS, history, entropy, or external scanner evidence.\n`,
  );
}
