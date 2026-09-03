/**
 * Extracts unique dynamic placeholder field paths from template HTML.
 * Recognizes: {{employee.full_name}}, {{#if x}}...{{/if}}, {{#each list}}...{{/each}}
 * Returns plain field paths only (control blocks like #if/#each/else are excluded).
 */
function extractPlaceholders(...htmlChunks) {
  const combined = htmlChunks.filter(Boolean).join('\n');
  const matches = combined.match(/\{\{\s*([#/]?[\w.]+)[^}]*\}\}/g) || [];

  const fieldPaths = new Set();
  for (const raw of matches) {
    const inner = raw.replace(/[{}]/g, '').trim();
    const firstToken = inner.split(/\s+/)[0];

    if (firstToken.startsWith('#') || firstToken.startsWith('/')) {
      // control block markers like #if, /if, #each, /each — skip the marker itself
      continue;
    }
    const cleanFieldPath = firstToken.split('|')[0]; // strip |redact / |redact:last4 filter suffix
    fieldPaths.add(cleanFieldPath);
  }
  return Array.from(fieldPaths);
}

/** Infers a rough data type from a field path for display purposes only. */
function guessDataType(fieldPath) {
  const lower = fieldPath.toLowerCase();
  if (lower.includes('date')) return 'date';
  if (lower.includes('salary') || lower.includes('amount') || lower.includes('count') || lower.includes('number')) {
    return 'number';
  }
  return 'string';
}

module.exports = { extractPlaceholders, guessDataType };
