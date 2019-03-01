process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

import '@babel/polyfill'
import Codebase from './src/Codebase'

(async () => {
  let codebase = await Codebase.factory()

  if(process.env.ACTION === 'classnames'){
    (await codebase.getAllClassNames()).forEach(className => {
      console.log(className)
    })

    return
  }

  codebase.transpile()
})()