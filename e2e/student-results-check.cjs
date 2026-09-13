'use strict';

/** Wait for this exact fixture's rendered result card, then click its real PDF button.
 * No extra Supabase reads or invented result data. No fixed sleeps / long awaited
 * page.evaluate around PDF work; browser operations return promptly.
 *
 * The first-ever PDF click lazy-loads the jspdf chunk. Vite's dep optimizer can
 * fully reload the page during that first dynamic import, which wipes any
 * URL.createObjectURL override installed beforehand. The checker therefore
 * retries (re-installing the capture and clicking again) until the deadline.
 */
async function verifyResultsAndDownload(page, { baseUrl, examId, examTitle, timeoutMs = 30000 }) {
  const observations = [];
  const pageErrors = [];
  const onResponse = async response => {
    try {
      const u = new URL(response.url());
      if (u.pathname !== '/rest/v1/rpc/portal_get_submissions' || response.request().method() !== 'POST') return;
      const body = await response.json().catch(() => null);
      observations.push({ status: response.status(), code: !Array.isArray(body) && body?.code || null,
        rowCount: Array.isArray(body) ? body.length : null,
        matchingExamRows: Array.isArray(body) ? body.filter(row => row.exam_id === examId).length : null });
    } catch { /* diagnostics must not change the workflow outcome */ }
  };
  const onPageError = error => {
    pageErrors.push(String(error && error.message || error).slice(0, 200));
  };
  page.on('response', onResponse);
  page.on('pageerror', onPageError);

  const installCapture = () => page.evaluate(() => {
    window.__studentPdfCapture?.restore?.();
    const original = URL.createObjectURL;
    const capture = { state: 'waiting', result: null, blobs: 0, types: [], restore: () => { URL.createObjectURL = original; } };
    window.__studentPdfCapture = capture;
    URL.createObjectURL = function (blob) {
      const url = original.call(this, blob);
      if (blob instanceof Blob) {
        capture.blobs += 1;
        capture.types.push(blob.type);
        if (/pdf/i.test(blob.type)) {
          capture.state = 'reading';
          blob.arrayBuffer().then(buffer => {
            const bytes = new Uint8Array(buffer);
            const head = String.fromCharCode(...bytes.slice(0, 5));
            capture.result = { ok: head === '%PDF-' && bytes.length > 100, bytes: bytes.length, head };
            capture.state = 'done';
          }).catch(err => { capture.state = 'error'; capture.err = String(err && err.message || err); });
        }
      }
      return url;
    };
  });

  const clickDownload = () => page.evaluate(title => {
    const heading = Array.from(document.querySelectorAll('h3')).find(h => h.textContent?.trim() === title);
    const card = heading?.closest('.card');
    const button = card?.querySelector('button[title="Download"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  }, examTitle);

  const probeState = () => page.evaluate(() => ({
    capture: window.__studentPdfCapture
      ? { state: window.__studentPdfCapture.state, result: window.__studentPdfCapture.result, blobs: window.__studentPdfCapture.blobs, types: window.__studentPdfCapture.types, err: window.__studentPdfCapture.err }
      : null,
    anyDownloadButton: Array.from(document.querySelectorAll('button[title="Download"]')).map(b => b.disabled),
  }));

  try {
    await page.goto(`${baseUrl}/portal/results`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const listed = await page.waitForFunction(title => {
      return Array.from(document.querySelectorAll('h3')).some(h => h.textContent?.trim() === title);
    }, { timeout: timeoutMs }, examTitle).then(() => true).catch(() => false);
    if (!listed) return { listed: false, pdf: null, diagnostics: { stage: 'results-card', rpc: observations,
      path: new URL(page.url()).pathname,
      emptyMessage: await page.evaluate(() => document.body.innerText.includes('কোনো পরীক্ষার ফলাফল নেই')) } };

    // Pre-warm the lazy PDF stack through Vite's transform pipeline. On a
    // cold dev server the first dynamic `import('jspdf')` inside pdf.ts waits
    // for dependency optimization (and can outlive the click deadline or
    // trigger a page reload that wipes the capture). Importing the module
    // here forces Vite to discover and optimize jspdf before the real click.
    await page.evaluate(() =>
      import('/src/lib/pdf.ts').then(() => 'ok').catch(() => 'failed')
    );

    const deadline = Date.now() + timeoutMs;
    let clicked = false;
    let finished = false;
    let pdf = null;
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      await installCapture();
      const ok = await clickDownload();
      if (!ok) {
        if (attempts === 1) {
          return { listed: true, pdf: { ok: false, err: 'RESULT_DOWNLOAD_BUTTON_UNAVAILABLE' },
            diagnostics: { stage: 'pdf-click', rpc: observations, pageErrors } };
        }
        // Button still disabled from an in-flight attempt; give it a moment.
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      clicked = true;
      const remaining = deadline - Date.now();
      finished = await page.waitForFunction(
        () => ['done', 'error'].includes(window.__studentPdfCapture?.state),
        { timeout: Math.max(1000, Math.min(15000, remaining)) }
      ).then(() => true).catch(() => false);
      pdf = await page.evaluate(() => {
        const c = window.__studentPdfCapture;
        return c?.result || { rawState: c?.state, blobs: c?.blobs, types: c?.types, err: c?.err };
      });
      if (finished && pdf?.ok) break;
      // Generation stalled or the page reloaded (Vite dep optimization wiped
      // the capture). Re-install and click again until the deadline.
    }
    if (!clicked) {
      return { listed: true, pdf: { ok: false, err: 'RESULT_DOWNLOAD_BUTTON_UNAVAILABLE' },
        diagnostics: { stage: 'pdf-click', rpc: observations, pageErrors } };
    }
    if (!finished || !pdf?.ok) {
      const probe = await probeState();
      return { listed: true, pdf: { ok: false, err: 'RESULT_PDF_NOT_PRODUCED_WITHIN_BOUND' },
        diagnostics: { stage: 'pdf-generation', attempts, probe, rpc: observations, pageErrors,
          path: new URL(page.url()).pathname } };
    }
    return { listed: true, pdf, diagnostics: { stage: 'complete', attempts, rpc: observations, pageErrors } };
  } finally {
    page.off('response', onResponse);
    page.off('pageerror', onPageError);
    await page.evaluate(() => {
      window.__studentPdfCapture?.restore?.();
      delete window.__studentPdfCapture;
    }).catch(() => {});
  }
}
module.exports = { verifyResultsAndDownload };
