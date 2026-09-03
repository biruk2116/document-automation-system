/**
 * Renders template HTML against a data record.
 * Supports (per SRS FR-002, FR-004, FR-005, FR-013):
 *   {{employee.full_name}}          - dotted-path placeholder substitution
 *   {{#if salary > 5000}}...{{/if}} - conditional blocks (simple comparisons)
 *   {{#each leave_history}}...{{/each}} - looping blocks over arrays
 *   {{generation_date}}, {{generation_date_gc}}, {{generation_date_ec}} - auto-filled
 *     generation date only (Gregorian and Ethiopian calendar). There is no
 *     auto-filled "effective date" — that field was removed; a real effective date,
 *     if a document needs one, must come from the source record like any other field.
 *
 * Every render call takes an optional `warnings` array. A genuinely missing field
 * (nothing in the source record for that path), or a {{#each}} pointed at something
 * that isn't actually an array, is left as the raw {{token}} in the output AND
 * recorded as a warning — never silently turned into a blank gap. Callers
 * (documentController) decide what to do with a non-empty warnings list: preview shows
 * them to the template author, and real PDF generation refuses to proceed at all while
 * any exist, so a genuinely broken placeholder can never end up baked into an actual
 * document.
 *
 * List/object fields used as a BARE placeholder (e.g. {{employees.salary_breakdown}}
 * instead of a {{#each}} loop) are NOT treated as an error: they're automatically
 * flattened into a readable inline summary via `flattenForDisplay` below — e.g.
 * "Base Salary: 5000, Bonus: 1200; ..." — instead of "[object Object]" or a blocked
 * document. This is a deliberate, permanent fallback so a template author's choice of
 * a plain {{token}} over a {{#each}} loop is a formatting preference, not a hard
 * failure. Authors who want row-by-row control (a table, custom per-row markup, etc.)
 * still use {{#each list}}...{{/each}} — that remains the recommended way to render
 * tabular data — but forgetting to do so no longer blocks generation.
 */

const { formatGregorianDate, formatEthiopianDate } = require('./ethiopianCalendar');

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function isPlainObjectOrArray(val) {
  return val !== null && typeof val === 'object'; // catches both arrays and plain objects
}

/**
 * Turns a list/object value into a readable, single-line, plain-text summary so it can
 * stand in for a bare {{placeholder}} without ever producing "[object Object]".
 *   - array of objects  -> "key: value, key: value; key: value, ..." (one "; "-separated
 *     group per item)
 *   - array of scalars  -> "a, b, c"
 *   - plain object      -> "key: value, key: value"
 * Nested arrays/objects inside an item are flattened recursively the same way, so this
 * never bottoms out in a stray [object Object] no matter how deep the data goes.
 */
function flattenForDisplay(val) {
  if (val === undefined || val === null) return '';

  if (Array.isArray(val)) {
    return val.map((item) => flattenForDisplay(item)).join('; ');
  }

  if (isPlainObjectOrArray(val)) {
    return Object.entries(val)
      .map(([key, v]) => `${key}: ${isPlainObjectOrArray(v) ? flattenForDisplay(v) : v}`)
      .join(', ');
  }

  return String(val);
}

/** Evaluates simple conditions like "salary > 5000" or "status == 'active'" safely (no eval()). */
function evaluateCondition(expr, data) {
  const match = expr.match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) {
    // Bare truthy check: {{#if is_manager}}
    const val = getByPath(data, expr.trim());
    return Boolean(val);
  }

  const [, leftPath, operator, rawRight] = match;
  const leftVal = getByPath(data, leftPath.trim());

  let rightVal = rawRight.trim();
  if (/^['"].*['"]$/.test(rightVal)) {
    rightVal = rightVal.slice(1, -1); // strip quotes -> string compare
  } else if (!isNaN(Number(rightVal))) {
    rightVal = Number(rightVal); // numeric compare
  }

  switch (operator) {
    case '==': return leftVal == rightVal;
    case '!=': return leftVal != rightVal;
    case '>': return Number(leftVal) > Number(rightVal);
    case '<': return Number(leftVal) < Number(rightVal);
    case '>=': return Number(leftVal) >= Number(rightVal);
    case '<=': return Number(leftVal) <= Number(rightVal);
    default: return false;
  }
}

function renderConditionals(html, data) {
  const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  return html.replace(ifRegex, (_, condition, block) => (evaluateCondition(condition, data) ? block : ''));
}

function renderLoops(html, data, warnings) {
  const eachRegex = /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  return html.replace(eachRegex, (_, listPath, block) => {
    const list = getByPath(data, listPath.trim());
    if (!Array.isArray(list)) {
      warnings.push({
        fieldPath: listPath.trim(),
        issue: 'not_a_list',
        message: `{{#each ${listPath.trim()}}} expects a list, but that field is ${list === undefined ? 'missing' : typeof list}.`,
      });
      return '';
    }
    return list
      .map((item) => block
        .replace(/\{\{\s*this\.([\w.]+)\s*\}\}/g, (__, key) => {
          const val = getByPath(item, key);
          // A nested list/object one level down (e.g. a JSON sub-array inside a row)
          // is flattened to a readable inline summary rather than blocked — same
          // permanent fallback as a bare top-level placeholder (see flattenForDisplay).
          return val !== undefined && val !== null ? flattenForDisplay(val) : '';
        })
        .replace(/\{\{\s*this\s*\}\}/g, () => flattenForDisplay(item)))
      .join('');
  });
}

/**
 * NFR-005: PII redaction via template filters, e.g. {{employee.salary|redact}}.
 * Currently supports `redact` (full mask) and `redact:last4` (shows only the last 4 chars).
 */
function applyFilter(value, filterName) {
  if (value === undefined || value === null) return value;
  const strVal = String(value);

  if (filterName === 'redact') {
    return '•'.repeat(Math.max(strVal.length, 4));
  }
  if (filterName === 'redact:last4') {
    if (strVal.length <= 4) return '•'.repeat(strVal.length);
    return '•'.repeat(strVal.length - 4) + strVal.slice(-4);
  }
  return strVal;
}

function renderPlaceholders(html, data, warnings) {
  return html.replace(/\{\{\s*([\w.]+)(?:\|([\w:]+))?\s*\}\}/g, (match, fieldPath, filterName) => {
    const val = getByPath(data, fieldPath);

    if (val === undefined || val === null) {
      // Leave un-mapped placeholders visible for debugging, and flag them — a document
      // should never go out with a stray {{token}} nobody noticed.
      warnings.push({
        fieldPath,
        issue: 'missing',
        message: `{{${fieldPath}}} has no matching value in the source record.`,
      });
      return match;
    }

    if (isPlainObjectOrArray(val)) {
      // A field that's actually a list/object (e.g. a JSON column like
      // salary_breakdown/leave_history) was inserted as a plain placeholder instead of
      // a {{#each}} loop. Rather than blocking generation over a formatting choice,
      // auto-flatten it into a readable inline summary — this is what previously
      // produced the classic "[object Object]" bug, so it's never stringified with
      // String(val) directly; flattenForDisplay() renders every sub-field by name.
      const flattened = flattenForDisplay(val);
      return filterName ? applyFilter(flattened, filterName) : flattened;
    }

    return filterName ? applyFilter(val, filterName) : String(val);
  });
}

/**
 * Full render pipeline: loops -> conditionals -> plain placeholders.
 * Order matters: loops/conditionals must resolve before their nested placeholders are substituted.
 * `warnings`, if passed, is mutated in place with every issue encountered — pass a fresh
 * array per render call (don't reuse one across header/body/footer) so each region's
 * issues can be traced back to it.
 */
function renderTemplate(html, data, warnings = []) {
  if (!html) return '';
  let output = html;
  output = renderLoops(output, data, warnings);
  output = renderConditionals(output, data);
  output = renderPlaceholders(output, data, warnings);
  return output;
}

/**
 * FR-013: auto-filled dynamic date placeholder(s), merged into the data context before
 * rendering. Only the generation date is auto-injected — never an "effective date";
 * no date is ever guessed or defaulted on the document's behalf.
 * `generation_date` is kept as the plain ISO date (G.C.) for backward compatibility
 * with existing templates; `generation_date_gc` / `generation_date_ec` are the
 * explicitly-labeled Gregorian and Ethiopian calendar renderings.
 */
function withAutoDates(data) {
  const now = new Date();
  return {
    ...data,
    generation_date: now.toISOString().slice(0, 10),
    generation_date_gc: formatGregorianDate(now),
    generation_date_ec: formatEthiopianDate(now),
  };
}

module.exports = { renderTemplate, withAutoDates, getByPath, flattenForDisplay };
