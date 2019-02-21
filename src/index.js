import '@babel/polyfill'
import { getConfig } from './Util'
import Transpiler from './Transpiler'

getConfig().then(({ sourceDir }) => new Transpiler(sourceDir).run())