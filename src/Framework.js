import _ from 'lodash'
import recast from 'recast'
import fs from 'fs-extra'
import Codebase from './Codebase'
import SourceFile from './SourceFile'

import {
  Ast,
  getAbsolutePath,
  readFile,
  writeFile,
  asyncForEach,
  code
} from './Util'

export default class Framework extends Codebase{
  async _doLoadSourceFiles(){
    let sdkFilePath = this.sourceDir

    let sdkFile = await SourceFile.factory({
      codebase     : this,
      codeFilePath : 'index.js',
      source       : await readFile(sdkFilePath)
    })

    return [sdkFile]
  }

  get manifestFilePath(){
    return getAbsolutePath(this.targetDir, 'index.js')
  }

  async transpile(){
    let widgets = [],
        classes = []

    this.sourceFiles[0].classes.forEach(cls => {
      // ExtJS doesn't create referenceable classes from overrides, so discard
      if(cls.override){
        return
      }

      let xtype = (cls.classAliases.find(alias => alias.startsWith('widget.')) || '').replace(/^widget\./, '')

      xtype
        ? widgets.push(`export const ${cls.exportName} = reactify('${xtype}')`)
        : classes.push(`export const ${cls.exportName} = window.${cls.className}`)
    })

    let framework = code(
      `import { reactify } from '@extjs/reactor'`,
      '',
      ...widgets,
      '',
      ...classes
    )

    writeFile(this.manifestFilePath, framework)
  }

  getIndexFileCode(classes){
    let longestClassName = Math.max(0, ...classes.map(cls => cls.className.length)),
        getComment       = cls => _.repeat(' ', (longestClassName - cls.className.length) * 2) + `// used ${cls.usage} times`

    classes = classes.sort((c1, c2) => c1.usage - c2.usage)

    return code(
      ...classes.map(cls => `export { default as ${cls.className} } from '${cls.sourceFile.codeFilePath}' ${getComment(cls)}`)
    )
  }
}