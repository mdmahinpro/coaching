async function gotoReady(page, url, ready, timeout = 15000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction(
    ({ path, marker }) => location.pathname === path && document.readyState !== 'loading' &&
      (!marker || document.body.innerText.includes(marker)),
    { timeout },
    { path: new URL(url).pathname, marker: ready?.marker ?? '' }
  );
  if (ready?.selector) await page.waitForSelector(ready.selector, { visible: true, timeout });
  if (ready?.state) await page.waitForFunction(ready.state, { timeout });
}

async function waitForPath(page, pathname, timeout = 15000) {
  await page.waitForFunction((path) => location.pathname === path, { timeout }, pathname);
}

module.exports = { gotoReady, waitForPath };
