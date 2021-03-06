import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'

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