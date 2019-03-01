import _ from 'lodash'
import recast from 'recast'
import { visit } from 'ast-types'
import fs from 'fs-extra'
import Framework from './Framework'
import SourceFile from './SourceFile'

import {
  Ast,
  getConfig,
  readFile,
  writeFile,
  isDirectory,
  getFilesRecursively,
  getAbsolutePath,
  asyncForEach,
  copySourceFileToTargetDir,
  getPathInTargetDirForSource,
  logError
} from './Util'

export default class Codebase{
  aliases = {}
  classes = {}
  classRe = []
  words   = []

  static async factory(){
    let config       = getConfig(),
        frameworkDir = getAbsolutePath(config.targetDir, config.frameworkDirName),
        framework    = await Framework.factory(frameworkDir, config.sdkFilePath)

    return new Codebase(config.sourceDir, config.targetDir, framework, config.words)
  }

  constructor(sourceDir, targetDir, framework, words = []){
    this.sourceDir   = sourceDir
    this.targetDir   = targetDir
    this.framework   = framework
    this.customWords = words

    this.addWords(words)
    this._addWordsFromClassNames(Object.values(this.framework.aliases))
  }

  getClassNameForAlias(alias){
    return this.aliases[alias] || this.framework.aliases[alias]
  }

  getClassForClassName(className){
    return this.classes[className] || this.framework.getClassForClassName(className) || null
  }

  async getAllClassNames(){
    await this.loadSourceFiles()
    let classNames = Object.keys(this.classes).map(className => this.classes[className].getExportName())
    return _.uniq(classNames).sort((n1, n2) => n1.localeCompare(n2))
  }

  async transpile(){
    let { sourceFiles, unparseable } = await this.loadSourceFiles()

    await this.prepareTargetDirectory()
    unparseable.forEach(file => copySourceFileToTargetDir(file))

    await asyncForEach(sourceFiles, async sourceFile => {
      let imports = sourceFile.getImports(),
          classes = sourceFile.classes.map(cls => cls.getES6Class())

      sourceFile.ast.program.body.push(...[...imports, ...classes])

      this.saveSourceFile(sourceFile)
      //sourceFile.missingFiles.forEach(className => logError(`Unknown file for class: ${className}`))
    })
  }

  loadSourceFiles(){
    this._loadSourceFiles = this._loadSourceFiles || this.doLoadSourceFiles()
    return this._loadSourceFiles
  }

  async doLoadSourceFiles(){
    let files       = getFilesRecursively(this.sourceDir),
        unparseable = files.filter(file => !file.endsWith('.js')),
        js          = files.filter(file => file.endsWith('.js')), //.filter(file => file.endsWith('NonClinical.js')),
        sourceFiles = []

    await asyncForEach(js, async file => {
      let sourceFile = new SourceFile(this, file, await readFile(file))
      sourceFile.parseable ? sourceFiles.push(sourceFile) : unparseable.push(file)
    })

    let classes = sourceFiles.reduce((classes, sourceFile) => ([...classes, ...sourceFile.classes]), [])

    classes.forEach(cls => {
      cls.classAliases.forEach(alias => {
        if(this.aliases[alias]){
          logError(`Duplicate alias: ${alias}`)
        }

        this.aliases[alias] = cls.className
      })

      if(this.classes[cls.className]){
        logError(`Duplicate class: ${cls.className}`)
      }

      this.classes[cls.className] = cls
      this.classRe.push(cls.getFileSearchRegExp())
    })

    classes.forEach(cls => {
      if(cls.parentClassName){
        cls.parentClass = this.getClassForClassName(cls.parentClassName)
      }
    })

    this._addWordsFromClassNames(classes.map(cls => cls.className))

    await asyncForEach(sourceFiles, async sourceFile => await sourceFile.initImports())

    return { sourceFiles, unparseable }
  }

  async prepareTargetDirectory(){
    let infoPath  = getAbsolutePath(this.targetDir, 'extjs2react.json'),
        generator = null

    try{
      generator = fs.readJsonSync(infoPath).generator
    }
    catch(e){}

    if(isDirectory(this.targetDir) && generator !== 'extjs2react'){
      throw 'Cannot clear or write to a directory not generated by extjs2react'
    }

    await fs.emptyDir(this.targetDir)
    await fs.writeFile(infoPath, JSON.stringify({ generator: 'extjs2react' }, null, 2))
  }

  saveSourceFile(sourceFile){
    writeFile(getPathInTargetDirForSource(sourceFile.filePath), sourceFile.toCode())
  }

  _addWordsFromClassNames(classNames){
    let classParts = _.flatten(classNames.map(className => className.split('.'))),
        classWords = _.flatten(classParts.map(classPart => classPart.split(/(?=[A-Z])/)))

    this.addWords(classWords.filter(word => word.length > 3).map(word => _.capitalize(word)))
  }

  addWords(words){
    words = _.uniq([...(this.words.map(w => w[0])), ...words]).sort((w1, w2) => {
      let diff = w1.length - w2.length
      return diff === 0 ? (this.customWords.includes(w1) ? 1 : -1) : diff
    })

    this.words = words.map(word => [word, new RegExp(word, 'gi')])
  }
}