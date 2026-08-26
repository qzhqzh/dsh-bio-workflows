import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = new URL('.', import.meta.url).pathname
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json' }

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const target = normalize(join(root, relative === 'preview.js' || relative === 'preview.js.map' ? `dist/${relative}` : relative))
  if (!target.startsWith(root)) {
    response.writeHead(403).end()
    return
  }
  try {
    const info = await stat(target)
    if (!info.isFile()) throw new Error('not-file')
    response.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  }
}).listen(4177, '127.0.0.1')
