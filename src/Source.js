import _ from 'lodash'
import { readFile, writeFile, getRelativePath, asyncForEach } from './Util'

export default class Source{
  static async fromFile(file){
    let source = new Source(file, await readFile(file))
    return source._isExtJS() ? source : null
  }

  static async addImports(sources){
    let classFiles   = {},
        classRe      = [],
        missingFiles = []

    sources.forEach(source => {
      source.getClassNames().forEach(className => {
        classFiles[className] = source.filePath
        classRe.push(Source.getClassRe(className))
      })
    })

    await asyncForEach(sources, async source => {
      let classes    = source.getClassesUsed(classRe).filter(cls => !cls.startsWith('Ext.')),
          oldImports = source.getImportedFiles(),
          newImports = _.uniq(classes.filter(cls => classFiles[cls]).map(cls => getRelativePath(source.filePath, classFiles[cls])).map(i => i.replace(/\.js$/, '')))

      missingFiles.push(...classes.filter(cls => !classFiles[cls]))

      let uniqOld = _.difference(oldImports, newImports)

      await source.addImports(newImports)
    })

    missingFiles.forEach(className => console.error(`[Error] Unknown file for class: ${className}`))
  }

  static getClassRe(className){
    return new RegExp(`(${className})\\W+?`, 'g')
  }

  constructor(filePath, source){
    this.filePath = filePath
    this.source   = source
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
      writeFile(this.filePath, importCode + (oldImports.length ? '' : '\n') + this.source)
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