import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  entry: { preview: 'entry.tsx' },
  outDir: 'dist',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  sourcemap: true,
  deps: { alwaysBundle: () => true, onlyBundle: false },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: { entryFileNames: 'preview.js' },
}

export default config
