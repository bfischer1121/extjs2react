import fs from 'fs-extra'
import path from 'path'

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