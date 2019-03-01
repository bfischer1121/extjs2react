import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'
import { namedTypes as t } from 'ast-types'

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

export const logError = message => {
  //console.error(message)
}

class AST{
  getMethodCall(node){
    let { object, property } = node.callee
    return (this.isIdentifier(object) && this.isIdentifier(property)) ? `${object.name}.${property.name}` : null
  }

  isIdentifier(node){
    return t.Identifier.check(node)
  }

  isString(node){
    return t.Literal.check(node) && _.isString(node.value)
  }

  isObject(node){
    return t.ObjectExpression.check(node)
  }

  getConfig(config, name){
    let property = this.getProperty(config, name)

    if(!property){
      return undefined
    }

    if(property.type === 'ArrayExpression'){
      return property.elements
    }

    return property.value
  }

  getProperty(object, name){
    return (this.getProperties(object, [name])[0] || {}).value
  }

  getPropertiesExcept(object, ...exclude){
    return this.getProperties(object, null, exclude)
  }

  getProperties(object, include, exclude){
    return object.properties.filter(({ key, value }) => {
      let name = key.name || key.value
      return (include ? include.includes(name) : true) && (exclude ? !exclude.includes(name) : true)
    })
  }
}

export const Ast = new AST()