import _ from 'lodash'
import recast from 'recast'
import fs from 'fs-extra'
import Codebase from './Codebase'
import SourceFile from './SourceFile'

import {
  Ast,
  getAbsolutePath,
  readFile,
  asyncForEach
} from './Util'

export default class Framework extends Codebase{
  static factory(sdkFilePath, targetDir){
    return Codebase.factory.bind(this)({ sourceDir: sdkFilePath, targetDir })
  }

  async doLoadSourceFiles(){
    let sdkFilePath = this.sourceDir

    let sdkFile = await SourceFile.factory({
      codebase       : this,
      codeFilePath   : sdkFilePath,
      importFilePath : sdkFilePath,
      source         : await readFile(sdkFilePath),
      forceParse     : true
    })

    return [sdkFile]
  }

  async getInfo(sdkFilePath){
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

  async initSodurceFiles(){
    let components = [
      {
        className : 'Button',
        xtype     : 'button',
        props     : [{ name: 'cls', usage: 42 }],
        usage     : 42,
        filePath  : `./components/${className}`
      }
    ]
  }

  transpile(){
    
  }

  getIndexFileCode(classes){
    let longestClassName = Math.max(0, ...classes.map(cls => cls.className.length)),
        getComment       = cls => _.repeat(' ', (longestClassName - cls.className.length) * 2) + `// used ${cls.usage} times`

    classes = classes.sort((c1, c2) => c1.usage - c2.usage)

    return code(
      ...classes.map(cls => `export { default as ${cls.className} } from '${cls.sourceFile.codeFilePath}' ${getComment(cls)}`)
    )
  }

  getComponentFileCode({ className, xtype, props }){
    let longestProp = Math.max(0, ...props.map(prop => prop.name.length)),
        getComment  = prop => _.repeat(' ', longestProp - prop.name.length) + `// used ${prop.usage} times`,
        comma       = (array, i, space = true) => i < (array.length - 1) ? ',' : (space ? ' ' : '')

    props = props.sort((p1, p2) => p1.usage - p2.usage)

    return code(
      `import { reactify } from '@extjs/reactor'`,
      `const ExtJS${className} = reactify('${xtype}')`,
      '',
      `export default class ${className} extends Component{`,
      [
        'render(){',
        [
          'const {',
            props.map((prop, i) => `${prop.name}${comma(props, i)} ${getComment(prop)}`),
          '} = this.props',
          '',
          `return <ExtJS${className} {...(this.props)} />`
        ],
        '}'
      ],
      '}'
    )
  }
}