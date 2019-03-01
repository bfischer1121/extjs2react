import _ from 'lodash'
import recast from 'recast'
import fs from 'fs-extra'
import { Ast, getAbsolutePath, readFile } from './Util'

export default class Framework{
  aliases = {}
  classes = {}

  static async factory(targetDir, sdkFilePath){
    return new Framework(targetDir, await Framework.getInfo(sdkFilePath))
  }

  static async getInfo(sdkFilePath){
    let filePath = getAbsolutePath(__dirname, '..', 'framework.json'),
        getInfo  = () => fs.readJsonSync(filePath)

    try{
      return getInfo()
    }
    catch(e){
      let sdk       = await readFile(sdkFilePath),
          ast       = recast.parse(sdk),
          normalize = config => _.compact(_.isArray(config) ? config : [config]),
          aliases   = {}

      visit(ast, {
        visitCallExpression: function(path){
          let { node } = path
 
          if(Ast.getMethodCall(node) === 'Ext.define'){
            let [className, data] = node.arguments

            if(Ast.isString(className) && Ast.isObject(data)){
              let xtype = normalize(Ast.getConfig(data, 'xtype')).map(xtype => `widget.${xtype}`),
                  alias = normalize(Ast.getConfig(data, 'alias'))

              if(xtype.length || alias.length){
                [...xtype, ...alias].forEach(alias => aliases[alias] = className.value)
              }
            }
          }

          this.traverse(path)
        }
      })

      await fs.writeFile(filePath, JSON.stringify({ aliases }, null, 2))
      return getInfo()
    }
  }

  constructor(targetDir, { aliases }){
    this.targetDir = targetDir
    this.aliases   = aliases
  }

  getClassForClassName(className){
    return this.classes[className] || null
  }
}