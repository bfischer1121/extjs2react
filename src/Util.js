import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'
import recast from 'recast'
import { namedTypes as t, eachField } from 'ast-types'

export const asyncForEach = async (array, callback) => {
  for(let i = 0; i < array.length; i++){
    await callback(array[i], i, array)
  }
}

export const asyncMap = async (array, callback) => {
  let results = []

  for(let i = 0; i < array.length; i++){
    results.push(await callback(array[i], i, array))
  }

  return results
}

const getSnapshotPath = id => getAbsolutePath(__dirname, '..', 'snapshots', `${id}.json`)

export const readSnapshot = async (id) => {
  try{
    return await fs.readJson(getSnapshotPath(id))
  }
  catch(e){
    return null
  }
}

export const saveSnapshot = async (id, data) => await writeFile(getSnapshotPath(id), JSON.stringify(data, null, 2))

export const getConfig = () => {
  let config = fs.readJsonSync(getAbsolutePath(__dirname, '..', 'config.json'))

  config.sourceDir = getAbsolutePath(__dirname, '..', config.sourceDir || 'nonexistant')

  if(!isDirectory(config.sourceDir)){
    throw `Source directory not found (${config.sourceDir}). Please adjust sourceDir in /config.json to point to your ExtJS project`
  }

  return config
}

export const getPathInTargetDirForSource = sourcePath => {
  let { sourceDir, targetDir } = getConfig()
  return getAbsolutePath(targetDir, sourcePath.replace(new RegExp('^' + sourceDir), ''))
}

export const copySourceFileToTargetDir = path => fs.copySync(path, getPathInTargetDirForSource(path))

export const isDirectory = path => {
  try{
    return fs.statSync(path).isDirectory()
  }
  catch(e){
    return false
  }
}

export const getAbsolutePath = (...paths) => path.resolve(path.join(...paths))

export const readFile = path => fs.readFile(path, 'utf8')

export const writeFile = (path, data) => fs.outputFile(path, data, 'utf8')

export const removeFile = path => fs.remove(path)

export const getFilesRecursively = dir => (
  fs.readdirSync(dir).reduce((filePaths, fileName) => {
    let file = path.join(dir, fileName)
    return [...filePaths, ...(fs.statSync(file).isDirectory() ? getFilesRecursively(file) : [file])]
  }, [])
)

export const getRelativePath = (fromFile, toFile) => {
  let fromParts   = fromFile.split('/'),
      toParts     = toFile.split('/'),
      commonParts = fromParts.findIndex((p, i) => p !== toParts[i])

  if(commonParts === -1){
    commonParts = toParts.length - 1
  }

  let parts = [...Array(fromParts.length - commonParts - 1).fill('..'), ...toParts.slice(commonParts)]

  if(parts[0] !== '..'){
    parts.unshift('.')
  }

  return parts.join('/')
}

export const logInfo = message => console.log(message)

export const logError = message => {
  //console.error(message)
}

export const code = (...lines) => {
  return lines.map(line => (
    _.isArray(line) ? code(...line).replace(/^/gm, '  ') : line
  )).join('\n').replace(/^\s+$/gm, '')
}

class AST{
  parseWithJSX(source){
    return recast.parse(source, { parser: require('recast/parsers/babel') }).program.body[0]
  }

  from(source){
    return recast.parse(source).program.body[0]
  }

  toString(ast){
    return recast.print(ast).code
  }

  copy(node){
    let copy = {}
    eachField(node, (name, value) => copy[name] = value)
    return copy
  }

  up(path, test){
    for(let parent = path.parent; parent; parent = parent.parent){
      if(test(parent.node)){
        return parent
      }
    }

    return null
  }

  getMethodCall(node){
    return this.toString(node.callee)
  }

  isIdentifier(node){
    return t.Identifier.check(node)
  }

  isString(node){
    return t.Literal.check(node) && _.isString(node.value)
  }

  isBoolean(node){
    return t.Literal.check(node) && _.isBoolean(node.value)
  }

  isNull(node){
    return t.Literal.check(node) && _.isNull(node.value)
  }

  isObject(node){
    return t.ObjectExpression.check(node)
  }

  isArray(node){
    return t.ArrayExpression.check(node)
  }

  isMemberExpression(node){
    return t.MemberExpression.check(node)
  }

  isTernary(node){
    return t.ConditionalExpression.check(node)
  }

  isFunction(node){
    return t.FunctionExpression.check(node)
  }

  isClass(node){
    return t.ClassDeclaration.check(node)
  }

  isMethod(node){
    return t.ClassMethod.check(node) || t.MethodDefinition.check(node)
  }

  getConfig(config, name){
    return this.toValue(this.getProperty(config, name))
  }

  getPropertyNode(object, name){
    return this.getProperties(object, [name])[0]
  }

  getProperty(object, name){
    return (this.getPropertyNode(object, name) || {}).value
  }

  getPropertiesExcept(object, ...exclude){
    return this.getProperties(object, null, exclude)
  }

  getProperties(object, include, exclude){
    return object.properties.filter(node => {
      let name = this.getPropertyName(node)
      return (include ? include.includes(name) : true) && (exclude ? !exclude.includes(name) : true)
    })
  }

  getPropertyName(node){
    return node.key.name || node.key.value
  }

  toValue(node){
    if(!node){
      return undefined
    }

    if(this.isArray(node)){
      return node.elements
    }

    if(this.isObject(node)){
      return node.properties
    }

    return node.value
  }
}

export const Ast = new AST()