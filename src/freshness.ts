/**
 * Reloads an old open tab after a new deploy, so testers never run stale code.
 * Checks when the tab comes back into view (and every 10 minutes); skips the
 * reload while a sheet is open so nobody loses an invite or a form.
 */
export function keepFresh(page: '/app' | '/') {
  const current = () =>
    [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => s.src.split('/').pop()).join()
  const mine = current()
  if (!mine || !/-[A-Za-z0-9_-]{8}\.js/.test(mine)) return // dev server or preview: nothing to compare

  let checking = false
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return
    checking = true
    try {
      const html = await (await fetch(page, { cache: 'no-store' })).text()
      const latest = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1].split('/').pop()).join()
      const busy = document.querySelector('.dsheet, [role="dialog"]')
      if (latest && latest !== mine && !busy) location.reload()
    } catch {
      /* offline: try next time */
    } finally {
      checking = false
    }
  }
  document.addEventListener('visibilitychange', check)
  window.setInterval(check, 10 * 60 * 1000)
}
