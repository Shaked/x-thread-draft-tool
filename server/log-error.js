// Logs an error that was not answered on purpose. Not the message or detail: a database error can echo draft
// text (tests/api/plaintext-leak-scan.test.js checks this). The name, code and stack frames say where it failed.
export function logError(label, err) {
  try {
    const header = String(err)
    const stack = String(err?.stack ?? '')
    // The frames come after the exact header (`Name: message`). A message with a line that starts with "at" stays
    // in the header and is not logged. A stack that does not start with its header logs no frames.
    const frames = stack.startsWith(header) ? stack.slice(header.length).split('\n').filter((line) => /^\s+at /.test(line)) : []
    console.error(label, err?.name, err?.code ?? '', frames.join('\n'))
  } catch {
    console.error(label, '(error could not be described)')
  }
}
