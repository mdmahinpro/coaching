'use strict';

/** Drive the actual public form. No fixture seeding or API mutations outside UI. */
async function submitPublicAdmission(page, { baseUrl, batchId, fields }) {
  await page.goto(`${baseUrl}/admission`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('input[name="name"]', { visible: true, timeout: 15000 });
  for (const name of ['name', 'email', 'phone', 'guardian_name', 'guardian_phone']) {
    const input = await page.$(`input[name="${name}"]`);
    if (!input || typeof fields[name] !== 'string') throw new Error(`ADMISSION_FORM_INPUT_MISSING:${name}`);
    await input.click({ clickCount: 3 });
    await input.type(fields[name]);
  }
  await clickButton(page, 'Next');
  await page.waitForSelector('select[name="batch_id"]', { visible: true, timeout: 10000 });
  const optionReady = await page.waitForFunction(
    id => Array.from(document.querySelectorAll('select[name="batch_id"] option')).some(o => o.value === id),
    { timeout: 15000 }, batchId
  ).then(() => true).catch(() => false);
  if (!optionReady) throw new Error('ADMISSION_BATCH_NOT_AVAILABLE: the exact active fixture batch did not appear');
  await page.select('select[name="batch_id"]', batchId);
  await clickButton(page, 'Review');
  const reviewReady = await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Submit Application'),
    { timeout: 10000 }
  ).then(() => true).catch(() => false);
  if (!reviewReady) throw new Error('ADMISSION_REVIEW_NOT_REACHED: inspect form validation; do not bypass it');
  await clickButton(page, 'Submit Application');
  const success = await page.waitForFunction(() => document.body.innerText.includes('আবেদন সফল!'), { timeout: 15000 }).then(() => true).catch(() => false);
  if (!success) throw new Error('ADMISSION_SUBMIT_NOT_CONFIRMED: UI did not show the success screen');
  return true;
}
async function clickButton(page, label) {
  const clicked = await page.evaluate(text => {
    const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text && !b.disabled);
    if (!button) return false;
    button.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`ADMISSION_BUTTON_UNAVAILABLE:${label}`);
}
module.exports = { submitPublicAdmission };
