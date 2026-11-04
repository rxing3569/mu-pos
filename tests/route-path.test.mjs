import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizedPath } from '../app/utils/route-path.mjs'

test('GitHub Pages redirected subpages match their navigation route', () => {
  for (const page of ['orders', 'settings', 'backup', 'accounts']) {
    assert.equal(normalizedPath(`/${page}/`), `/${page}`)
    assert.equal(normalizedPath(`/${page}`), `/${page}`)
  }
  assert.equal(normalizedPath('/'), '/')
})
