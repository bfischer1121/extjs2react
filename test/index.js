import { getRelativePath } from '../src/Util'

const tests = [
  getRelativePath('/foo.js', '/foo.js') === './foo.js',
  getRelativePath('/foo.js', '/bar.js') === './bar.js',
  getRelativePath('/1/foo.js', '/1/bar.js') === './bar.js',
  getRelativePath('/1/2/foo.js', '/1/2/bar.js') === './bar.js',
  getRelativePath('/1/foo.js', '/2/bar.js') === '../2/bar.js',
  getRelativePath('/1/a/foo.js', '/1/bar.js') === '../bar.js',
  getRelativePath('/1/foo.js', '/1/a/bar.js') === './a/bar.js',
  getRelativePath('/1/2/3/4/foo.js', '/1/2/a/b/c/bar.js') === '../../a/b/c/bar.js'
]

tests.every(test => test)
  ? console.log('Tests passed')
  : console.error('Tests failed')