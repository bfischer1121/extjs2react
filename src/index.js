import '@babel/polyfill'
import { getConfig } from './Util'
import Transpiler from './Transpiler'

new Transpiler(getConfig().sourceDir).run()