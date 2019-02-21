import path from 'path'
import { getFilesRecursively, asyncMap } from './Util'
import Source from './Source'

export default class Transpiler{
  constructor(sourceDir){
    this.sourceDir = sourceDir
  }

  async run(){
    let js      = getFilesRecursively(this.sourceDir).filter(file => file.endsWith('.js')),
        sources = (await asyncMap(js, async file => Source.fromFile(file))).filter(source => !!source)

    await Source.addImports(sources)
  }
}