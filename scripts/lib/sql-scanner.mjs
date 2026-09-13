// Shared SQL scanning utilities for the staging-bundle generator and its tests.
//
// These scanner must understand dollar-quoted bodies (PL/pgSQL), single-quoted
// string literals, line comments, and block comments so that `BEGIN;`/`COMMIT;`
// /`ROLLBACK;` *inside a function/DO body or a string* are never mistaken for
// top-level transaction-control. No statements are mutated here; the scanner is
// read-only and returns structural information.

const TRANSACTION_KEYWORDS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'START']);

// True when `text` is a bare transaction-control line such as `BEGIN;`,
// `START TRANSACTION;`, `COMMIT;`, or `ROLLBACK;` optionally followed by a
// `--` comment. Assumes `text` is already trimmed and OUTSIDE any dollar body.
function isTransactionControlLine(text) {
  if (text.startsWith('--') || text.length === 0) return false;
  const noTrailingComment = text.replace(/--.*$/, '').trim();
  // Normalize `START TRANSACTION;` -> treat START specially.
  const body = noTrailingComment.replace(/;$/, '').trim();
  const upper = body.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return true;
  if (upper.startsWith('START TRANSACTION')) return true;
  return false;
}

function transactionKindOf(text) {
  const noTrailingComment = text.replace(/--.*$/, '').trim();
  const body = noTrailingComment.replace(/;$/, '').trim().toUpperCase();
  if (body === 'BEGIN') return 'BEGIN';
  if (body === 'COMMIT') return 'COMMIT';
  if (body === 'ROLLBACK') return 'ROLLBACK';
  if (body.startsWith('START TRANSACTION')) return 'BEGIN';
  return null;
}

// Scan `sql` and return its top-level (depth-0) transaction-control statements.
// Returned entries: { line, kind, raw } where `line` is 1-based and `kind` is
// an upper-case transaction keyword (BEGIN/COMMIT/ROLLBACK).
export function scanTopLevelTransactionControls(sql) {
  const lines = sql.split(/\r?\n/);
  const result = [];
  let dollarStack = []; // open dollar-quote tags, e.g. '$$' or '$fn$'
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    const L = line.length;

    while (j < L) {
      const rest = line.slice(j);
      const c = line[j];

      if (dollarStack.length > 0) {
        const openTag = dollarStack[dollarStack.length - 1];
        if (rest.startsWith(openTag)) {
          dollarStack.pop();
          j += openTag.length;
          continue;
        }
        j++;
        continue;
      }

      if (inBlockComment) {
        const closeIdx = rest.indexOf('*/');
        if (closeIdx === -1) {
          j = L;
        } else {
          inBlockComment = false;
          j += closeIdx + 2;
        }
        continue;
      }

      if (c === '-' && rest.startsWith('--')) {
        break; // line comment runs to end of line
      }
      if (c === '/' && rest.startsWith('/*')) {
        const closeIdx = rest.indexOf('*/');
        if (closeIdx === -1) {
          inBlockComment = true;
          j = L;
        } else {
          j += closeIdx + 2;
        }
        continue;
      }
      if (c === "'") {
        // single-quoted string, with '' as an escaped quote
        j++;
        while (j < L) {
          if (line[j] === "'") {
            if (line[j + 1] === "'") {
              j += 2;
              continue;
            }
            j++;
            break;
          }
          j++;
        }
        continue;
      }

      const dollarMatch = /^\$([A-Za-z_0-9]*)\$/.exec(rest);
      if (dollarMatch) {
        dollarStack.push(dollarMatch[0]);
        j += dollarMatch[0].length;
        continue;
      }

      if (/^[A-Za-z]/.test(c)) {
        const wordMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
        const kw = wordMatch && wordMatch[1].toUpperCase();
        if (kw && TRANSACTION_KEYWORDS.has(kw)) {
          if (kw === 'COMMIT' || kw === 'ROLLBACK') {
            const tail = rest.slice(wordMatch[1].length).trimStart();
            if (/^;?\s*(--.*)?$/.test(tail)) {
              result.push({ line: i + 1, kind: kw, raw: line });
            }
          } else if (kw === 'BEGIN') {
            const tail = rest.slice(wordMatch[1].length).trimStart();
            if (/^;?\s*(--.*)?$/.test(tail)) {
              result.push({ line: i + 1, kind: 'BEGIN', raw: line });
            }
          } else if (kw === 'START') {
            // only recognize `START TRANSACTION;`
            const tail = rest.slice(wordMatch[1].length).trimStart();
            if (/^TRANSACTION\s*;?\s*(--.*)?$/i.test(tail)) {
              result.push({ line: i + 1, kind: 'BEGIN', raw: line });
            }
          }
        }
        j += wordMatch[1].length;
        continue;
      }
      j++;
    }
  }

  return result;
}

// Split `sql` into a transactional body and a post-commit section.
// The transactional body contains everything up to the first top-level COMMIT;
// (with leading BEGIN; removed and that COMMIT; removed). The post-commit
// section contains everything after that COMMIT;. Files with no top-level
// COMMIT; have no post-commit section and their whole content is transactional.
export function splitTransactionAndPostCommit(sql) {
  const txc = scanTopLevelTransactionControls(sql);
  const commitIndex = txc.findIndex((t) => t.kind === 'COMMIT');
  if (commitIndex === -1) {
    return { txBody: stripLeadingBegin(sql), postCommit: '' };
  }
  const lines = stripLeadingBegin(sql).split(/\r?\n/);
  // Recompute line offset: stripping a leading BEGIN line (if any) shifts lines.
  // Re-scan on the stripped text to get exact split point.
  const stripped = stripLeadingBegin(sql);
  const strippedTxc = scanTopLevelTransactionControls(stripped);
  const firstCommit = strippedTxc.find((t) => t.kind === 'COMMIT');
  if (!firstCommit) {
    return { txBody: stripped, postCommit: '' };
  }
  const commitLine = firstCommit.line; // 1-based
  const allLines = stripped.split(/\r?\n/);
  const txBody = allLines.slice(0, commitLine - 1).join('\n');
  const postCommit = allLines.slice(commitLine).join('\n');
  return { txBody, postCommit };
}

// Remove a single leading top-level BEGIN; line (statement ordering helper).
function stripLeadingBegin(sql) {
  const txc = scanTopLevelTransactionControls(sql);
  if (txc.length === 0 || txc[0].kind !== 'BEGIN') return sql;
  const first = txc[0];
  const lines = sql.split(/\r?\n/);
  lines.splice(first.line - 1, 1);
  return lines.join('\n');
}

// Extract each dollar-quoted body as `{ tag, opener, closer, content, block }`
// where `block` is the full text including both delimiters. Used to assert that
// function/DO bodies survive assembly verbatim.
export function extractDollarBodies(sql) {
  const bodies = [];
  const re = /\$([A-Za-z_0-9]*)\$/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tag = m[0];
    const start = m.index;
    const closerStart = sql.indexOf(tag, m.index + tag.length);
    if (closerStart === -1) break; // unbalanced; stop
    const block = sql.slice(start, closerStart + tag.length);
    const content = sql.slice(m.index + tag.length, closerStart);
    bodies.push({ tag, content, block });
    re.lastIndex = closerStart + tag.length;
  }
  return bodies;
}

// Count `$$`-style and `$tag$`-style dollar delimiters, ignoring those that
// appear inside dollar bodies or quoted strings is beyond scope here; this is a
// coarse structural balance check for the tests. Returns an object tallying
// each distinct delimiter tag and whether each is balanced.
export function tallyDollarTags(sql) {
  const counts = new Map();
  const lines = sql.split(/\r?\n/);
  for (const line of lines) {
    const re = /\$([A-Za-z_0-9]*)\$/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const tag = m[0];
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return { tags: counts, balanced: [...counts.values()].every((n) => n % 2 === 0) };
}