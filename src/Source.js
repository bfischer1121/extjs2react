import _ from 'lodash'
import recast from 'recast'

import {
  getConfig,
  readFile,
  writeFile,
  getAbsolutePath,
  getPathInTargetDirForSource,
  getRelativePath,
  asyncForEach
} from './Util'

export default class Source{
  constructor(filePath, source){
    this.filePath  = filePath
    this.source    = source
    this.parseable = this._isExtJS()

    if(this.parseable){
      this.ast       = recast.parse(source)
      this.parseable = (this.toCode() === source)
    }
  }

  static getClassRe(className){
    return new RegExp(`(${className})\\W+?`, 'g')
  }

  toCode(){
    return this.parseable ? recast.print(this.ast).code : this.source
  }

  save(){
    writeFile(getPathInTargetDirForSource(this.filePath), this.source)
  }

  getClassNames(){
    return this._getMatches(/Ext\.define\(\s*['|"]([^'|"]+)['|"]/g).map(match => match[1])
  }

  getClassesUsed(classRe){
    let internalCls = this.getClassNames(),
        externalCls = classRe.reduce((classes, re) => [...classes, ...(this._getMatches(re).map(match => match[1]))], [])

    return _.uniq(externalCls.filter(cls => !internalCls.includes(cls)))
  }

  getExtendedClasses(){
    return this._getMatches(/extend\s*:\s*['|"]([^'|"]+)['|"]/g).map(match => match[1])
  }

  _isExtJS(){
    return this.getClassNames().length > 0
  }

  getImportedFiles(){
    return [
      ...(this._getMatches(/import\s+['|"]([^'|"]+)['|"]/g).map(match => match[1])),
      ...(this._getMatches(/import.+from\s+['|"]([^'|"]+)['|"]/g).map(match => match[1]))
    ]
  }

  addImports(filePaths){
    let oldImports = this.getImportedFiles(),
        newImports = _.difference(filePaths, oldImports).sort(),
        importCode = newImports.map(file => `import '${file}'\n`).join('')

    if(newImports.length){
      this.source = importCode + (oldImports.length ? '' : '\n') + this.source
    }
  }

  _getMatches(regExp){
    let matches = [],
        match

    while(match = regExp.exec(this.source)){
      matches.push(match)
    }

    return matches
  }
}