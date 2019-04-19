import _ from 'lodash'
import recast from 'recast'
import { visit } from 'ast-types'
import fs from 'fs-extra'
import Ast from './Ast'
import SourceFile from './SourceFile'
import * as hooks from './Hooks'

import {
  getConfig,
  readFile,
  writeFile,
  removeFile,
  readSnapshot,
  saveSnapshot,
  isDirectory,
  getFilesRecursively,
  getAbsolutePath,
  asyncForEach,
  copySourceFileToTargetDir,
  getPathInTargetDirForSource,
  logInfo,
  logError
} from './Util'

export default class Codebase{
  unparseable          = []
  aliases              = {}
  classes              = {}
  _alternateClassNames = {}
  _classRe             = []
  _properties          = {}
  allClassesRegistered = false

  _words = [
    'Change',
    'Tap',
    'HeaderPin',
    'KeyUp',
    'Initialize',
    'Disclose',
    'Record',
    'Validated',
    'Cmp',
    'Icon',
    'Mode',
    'Width'
  ]

  static async factory(config){
    let codebase = new this(config)
    await codebase._loadSourceFiles()
    codebase._addSourceFiles()
    return codebase
  }

  static async loadSnapshot(id, config){
    let snapshot = await readSnapshot(id)

    if(!snapshot){
      let codebase = await this.factory(config)
      await codebase.saveSnapshot(id)
      snapshot = await readSnapshot(id)
    }

    return this.fromSnapshot(config, snapshot)
  }

  static fromSnapshot(config, { sourceFiles, unparseable, words }){
    let codebase = new this({ ...config, words })

    codebase.fromSnapshot = true

    codebase.sourceFiles = sourceFiles.map(snapshot => SourceFile.fromSnapshot(codebase, snapshot))
    codebase.unparseable = unparseable

    codebase._addSourceFiles()

    return codebase
  }

  toSnapshot(){
    return {
      sourceFiles : this.sourceFiles.map(sourceFile => sourceFile.toSnapshot()),
      unparseable : this.unparseable,
      words       : this._customWords
    }
  }

  async saveSnapshot(id){
    await saveSnapshot(id, this.toSnapshot())
  }

  constructor({ sourceDir, targetDir, parentCodebase, words = [] }){
    this.sourceDir      = sourceDir
    this.targetDir      = targetDir
    this.parentCodebase = parentCodebase
    this._customWords   = words

    this._addWords(this._customWords)

    if(this.parentCodebase){
      this._addWordsFromClassNames(Object.values(this.parentCodebase.aliases))
    }
  }

  getClassNameForAlias(alias){
    return this.aliases[alias] || (this.parentCodebase ? this.parentCodebase.getClassNameForAlias(alias) : null) || null
  }

  getClassForClassName(className){
    className = this._alternateClassNames[className] || className
    return this.classes[className] || (this.parentCodebase ? this.parentCodebase.getClassForClassName(className) : null) || null
  }

  get classNames(){
    let classNames = Object.keys(this.classes).map(className => this.classes[className].exportName)
    return _.uniq(classNames).sort((n1, n2) => n1.localeCompare(n2))
  }

  get classRe(){
    return this.parentCodebase ? [...(this._classRe), ...(this.parentCodebase.classRe)] : this._classRe
  }

  get methodCalls(){
    let fnCalls = _.flattenDeep(this.sourceFiles.map(sourceFile => sourceFile.classes.map(cls => cls.methodCalls))),
        objects = ['Ext', 'Math'],
        counts  = {}

    fnCalls.forEach(fnCall => {
      let [object, method] = fnCall.split('.')

      if(object === 'me'){
        object = 'this'
      }

      fnCall = (objects.includes(object) ? object : '') + '.' + method

      counts[fnCall] = counts[fnCall] || 0
      counts[fnCall]++
    })

    return Object.keys(counts).map(c => ({ method: c, count: counts[c] })).sort((c1, c2) => c2.count - c1.count)
  }

  async transpile(){
    await this._prepareTargetDirectory()
    this.unparseable.forEach(file => copySourceFileToTargetDir(file))

    if(hooks.beforeTranspile){
      hooks.beforeTranspile(this)
    }

    await asyncForEach(this.sourceFiles.filter(file => !file.discard), async sourceFile => {
      this._saveSourceFile(sourceFile, sourceFile.transpile())
      //sourceFile.missingFiles.forEach(className => logError(`Unknown file for class: ${className}`))
    })

    await asyncForEach(this.sourceFiles.filter(file => !!file.discard), async sourceFile => {
      await this._removeSourceFile(sourceFile)
    })

    this.logTopProperties()
  }

  logProperty(name){
    this._properties[name] = this._properties[name] || 0
    this._properties[name]++
  }

  logTopProperties(){
    let props = Object.keys(this._properties).sort((p1, p2) => this._properties[p2] - this._properties[p1])
    logInfo('*** Top Properties ***')
    props.forEach(prop => logInfo(`${this._properties[prop]} => ${prop}`))
  }

  _addSourceFiles(){
    let classes = this.sourceFiles.reduce((classes, sourceFile) => ([...classes, ...sourceFile.classes]), [])

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
      cls.alternateClassNames.forEach(name => this._alternateClassNames[name] = cls.className)
      this._classRe.push(...(cls.fileSearchRegExps.map(re => ({ re, cls }))))
    })

    this._addWordsFromClassNames(classes.map(cls => cls.className))
    this.allClassesRegistered = true

    // all classes should be initialized before the source files are initialized
    classes.forEach(cls => cls.init())
    this.sourceFiles.forEach(sourceFile => sourceFile.init())
  }

  async _loadSourceFiles(){
    this.sourceFiles = this.sourceFiles || await this._doLoadSourceFiles()
  }

  async _doLoadSourceFiles(){
    let files       = getFilesRecursively(this.sourceDir),
        unparseable = files.filter(file => !file.endsWith('.js')),
        js          = files.filter(file => file.endsWith('.js')),
        sourceFiles = []

    await asyncForEach(js, async filePath => {
      let sourceFile = await SourceFile.factory({
        codebase     : this,
        codeFilePath : filePath,
        source       : await readFile(filePath)
      })

      sourceFile.parseable ? sourceFiles.push(sourceFile) : unparseable.push(filePath)
    })

    this.unparseable = unparseable

    return sourceFiles
  }

  async _prepareTargetDirectory(){
    let infoPath  = getAbsolutePath(this.targetDir, 'extjs2react.json'),
        generator = null

    try{
      generator = fs.readJsonSync(infoPath).generator
    }
    catch(e){}

    if(isDirectory(this.targetDir) && generator !== 'extjs2react'){
      throw 'Cannot clear or write to a directory not generated by extjs2react'
    }

    await fs.writeFile(infoPath, JSON.stringify({ generator: 'extjs2react' }, null, 2))
  }

  _saveSourceFile(sourceFile, code){
    writeFile(getPathInTargetDirForSource(sourceFile.codeFilePath), code)
  }

  _removeSourceFile(sourceFile){
    removeFile(getPathInTargetDirForSource(sourceFile.codeFilePath))
  }

  _addWordsFromClassNames(classNames){
    let classParts = _.flatten(classNames.map(className => className.split('.'))),
        classWords = _.flatten(classParts.map(classPart => classPart.split(/(?=[A-Z])/)))

    this._addWords(classWords.filter(word => word.length > 3).map(word => _.capitalize(word)))
  }

  _addWords(words){
    let priorWords = _.isArray(this._words[0]) ? this._words.map(w => w[0]) : this._words

    words = _.uniq([...priorWords, ...words]).sort((w1, w2) => {
      let diff = w1.length - w2.length
      return diff === 0 ? (this._customWords.includes(w1) ? 1 : -1) : diff
    })

    this._words = words.map(word => [word, new RegExp(word, 'gi')])
  }

  capitalize(string){
    string = this._words.reduce((string, [word, wordRe]) => string.replace(wordRe, word), string)
    return string[0].toUpperCase() + string.slice(1)
  }
}