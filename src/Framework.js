import _ from 'lodash'
import recast from 'recast'
import fs from 'fs-extra'
import Ast from './Ast'
import Codebase from './Codebase'
import SourceFile from './SourceFile'

import {
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
    let exports = this.sourceFiles[0].undiscardedClasses
      .filter(cls => !cls.override)
      .map(cls => {
        let xtype = (cls.classAliases.find(alias => alias.startsWith('widget.')) || '').replace(/^widget\./, ''),
            value = xtype ? `r('${xtype}')` : `w.${cls.className}`

        return { name: cls.exportName, value, widget: !!xtype }
      })
      .sort((e1, e2) => e1.name.localeCompare(e2.name))

    let getExportCode = exports => {
      let namePad = Math.max(0, ...exports.map(({ name }) => name.length))
      return exports.map(({ name, value }) => `export const ${name.padEnd(namePad)} = ${value}`)
    }

    let framework = code(
      `import { reactify } from '@sencha/ext-react'`,
      '',
      `export * from './define'`,
      '',
      'const r = reactify',
      'const w = window',
      '',
      ...getExportCode(exports.filter(exp => exp.widget)),
      '',
      ...getExportCode(exports.filter(exp => !exp.widget))
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