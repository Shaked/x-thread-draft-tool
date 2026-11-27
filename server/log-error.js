// Logs an error that was not answered on purpose. Not the message or detail: a database error can echo draft
// text (tests/api/plaintext-leak-scan.test.js checks this). The name, code and stack frames say where it failed.
export function logError(label, err) {
  const frames = String(err?.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line))
  console.error(label, err?.name, err?.code ?? '', frames.join('\n'))
}
