import _ from 'lodash'
import recast from 'recast'
import { getConfig, readFile, writeFile, getAbsolutePath, getRelativePath, asyncForEach } from './Util'

export default class Source{
  constructor(filePath, source){
    this.filePath = filePath
    this.source   = source
    this.valid    = this._isExtJS()

    if(this.valid){
      this.ast   = recast.parse(source)
      this.valid = (this.toCode() === source)
    }
  }

  static async fromFile(file){
    let source = new Source(file, await readFile(file))
    return source.valid ? source : null
  }

  static getClassRe(className){
    return new RegExp(`(${className})\\W+?`, 'g')
  }

  toCode(){
    return recast.print(this.ast).code
  }

  saveOutput(){
    let { sourceDir, targetDir } = getConfig(),
        path = getAbsolutePath(targetDir, this.filePath.replace(new RegExp('^' + sourceDir), ''))

    writeFile(path, this.source)
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
      this.saveOutput()
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