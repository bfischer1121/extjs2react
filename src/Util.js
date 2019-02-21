import fs from 'fs'
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

export const getConfig = async () => {
  let config = JSON.parse(await readFile(path.join(__dirname, '..', 'config.json')))

  config.sourceDir = path.resolve(path.join(__dirname, '..', config.sourceDir || 'nonexistant'))

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

export const readFile = path => (
  new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (error, data) => error ? reject(error) : resolve(data))
  })
)

export const writeFile = (path, data) => (
  new Promise((resolve, reject) => {
    fs.writeFile(path, data, 'utf8', (error, data) => error ? reject(error) : resolve())
  })
)

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