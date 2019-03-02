process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

import '@babel/polyfill'
import Codebase from './src/Codebase'
import Framework from './src/Framework'
import { getConfig, getAbsolutePath } from './src/Util'

(async () => {
  let { sourceDir, targetDir, sdkFilePath, frameworkDirName, words } = getConfig()

  let framework = await Framework.factory(sdkFilePath, getAbsolutePath(targetDir, frameworkDirName)),
      codebase  = await Codebase.factory({ sourceDir, targetDir, words, parentCodebase: framework })

  if(process.env.ACTION === 'classnames'){
    (await codebase.getAllClassNames()).forEach(className => {
      console.log(className)
    })

    return
  }

  codebase.transpile()
})()