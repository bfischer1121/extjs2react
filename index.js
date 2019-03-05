process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

import '@babel/polyfill'
import Codebase from './src/Codebase'
import Framework from './src/Framework'
import { getConfig, getAbsolutePath } from './src/Util'

(async () => {
  let { sourceDir, targetDir, sdkFilePath, frameworkDirName, words } = getConfig()

  let framework = await Framework.loadSnapshot('framework', {
    sourceDir: sdkFilePath,
    targetDir: getAbsolutePath(targetDir, frameworkDirName)
  })

  let codebase = await Codebase.factory({ sourceDir, targetDir, words, parentCodebase: framework })

  await codebase.saveSnapshot('codebase')

  if(process.env.ACTION === 'classnames'){
    codebase.classNames.forEach(className => console.log(className))
    return
  }

  if(process.env.ACTION === 'methodcalls'){
    codebase.methodCalls.forEach(methodCall => console.log(`${methodCall.count} => ${methodCall.method}`))
    return
  }

  codebase.transpile()
})()